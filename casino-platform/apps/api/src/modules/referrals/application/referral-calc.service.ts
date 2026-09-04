import { Inject, Injectable, Logger } from '@nestjs/common'
import { Decimal } from 'decimal.js'

import { errorMessage } from '@/common/utils/error-message'

import { type Currency } from '@casino/shared-types'
import { money } from '@casino/shared-utils'

import { WalletFacade } from '../../wallet/application/wallet.facade'
import { type CurrencySumRow, IReferralRepository, REFERRAL_REPOSITORY } from '../domain/referral.repository'

@Injectable()
export class ReferralCalcService {
  private logger = new Logger(ReferralCalcService.name)

  constructor(
    private readonly walletFacade: WalletFacade,
    @Inject(REFERRAL_REPOSITORY) private readonly repo: IReferralRepository,
  ) {}

  async runDaily(dateStr?: string): Promise<{ processed: number; credited: number; date: Date; }> {
    const date = dateStr ? new Date(dateStr) : new Date(Date.now() - 86400000)
    const dayStart = new Date(date)
    dayStart.setUTCHours(0, 0, 0, 0)
    const dayEnd = new Date(dayStart)
    dayEnd.setUTCHours(23, 59, 59, 999)
    const rewardRate = new Decimal(process.env['REFERRAL_REWARD_RATE'] || '0.05')
    // get all users with referrer
    const referredUsers = await this.repo.findReferredUsers()
    let processed = 0
    let credited = 0
    for (const ru of referredUsers) {
      if (!ru.referredBy) {
        continue
      }
      const res = await this.processUserRewards({
        referredId: ru.id,
        referrerId: ru.referredBy!,
        dayStart,
        dayEnd,
        rewardRate,
      })
      processed += res.processed
      credited += res.credited
    }
    this.logger.log(
      `Referral daily: processed=${processed} credited=${credited} date=${dayStart.toISOString().slice(0, 10)}`,
    )
    return { processed, credited, date: dayStart }
  }

  /** GGR-share за сутки по всем валютам игрока: создаёт referralReward и кредитует награду рефереру. */
  private async processUserRewards(args: {
    referredId: string
    referrerId: string
    dayStart: Date
    dayEnd: Date
    rewardRate: Decimal
  }): Promise<{ processed: number; credited: number }> {
    const { referredId, referrerId, dayStart, dayEnd, rewardRate } = args
    const bets = await this.repo.sumTransactions({ userId: referredId, type: 'bet', from: dayStart, to: dayEnd })
    const wins = await this.repo.sumTransactions({ userId: referredId, type: 'win', from: dayStart, to: dayEnd })
    const currencies = new Set<string>([
      ...bets.map((b: CurrencySumRow) => b.currency),
      ...wins.map((w: CurrencySumRow) => w.currency),
    ])

    let processed = 0
    let credited = 0
    for (const cur of currencies) {
      const res = await this.processCurrencyReward({
        referredId,
        referrerId,
        dayStart,
        dayEnd,
        rewardRate,
        cur,
        betSum: bets.find((b: CurrencySumRow) => b.currency === cur)?.amount ?? '0',
        winSum: wins.find((w: CurrencySumRow) => w.currency === cur)?.amount ?? '0',
      })
      processed += res.processed
      credited += res.credited
    }
    return { processed, credited }
  }

  /** Одна валюта: расчёт GGR, дедупликация, создание награды и кредитование. */
  private async processCurrencyReward(args: {
    referredId: string
    referrerId: string
    dayStart: Date
    dayEnd: Date
    rewardRate: Decimal
    cur: string
    betSum: string
    winSum: string
  }): Promise<{ processed: number; credited: number }> {
    const { referredId, referrerId, dayStart, dayEnd, rewardRate, cur, betSum, winSum } = args
    const ggr = new Decimal(betSum).minus(winSum)
    const isPositiveGgr = ggr.gt(0)
    const status = isPositiveGgr ? 'pending' : 'zero'
    const rewardAmount = isPositiveGgr ? ggr.times(rewardRate).toFixed(8) : '0'

    const exists = await this.repo.findReward({
      referrerId,
      referredId,
      periodStart: dayStart,
      currency: cur,
    })
    if (exists) {
      return { processed: 0, credited: 0 }
    }

    const rr = await this.repo.createReward({
      referrerId,
      referredId,
      type: 'ggr_share',
      periodStart: dayStart,
      periodEnd: dayEnd,
      ggrAmount: isPositiveGgr ? ggr.toFixed(8) : '0',
      rewardRate: rewardRate.toFixed(4),
      rewardAmount,
      currency: cur,
      status,
    })

    if (!isPositiveGgr || !money.isPositive(rewardAmount)) {
      return { processed: 1, credited: 0 }
    }
    try {
      await this.walletFacade.credit({
        userId: referrerId,
        currency: cur as Currency,
        amount: rewardAmount,
        type: 'REFERRAL_REWARD', // enum LedgerEntryType (было 'referral_reward' — не из enum)
        idempotencyKey: `ref_reward_${rr.id}`,
        description: `Referral reward for ${referredId} (${dayStart.toISOString().slice(0, 10)})`,
        metadata: { referralRewardId: rr.id, referredId },
      })
      await this.repo.updateReward(rr.id, { status: 'credited', creditedAt: new Date() })
      return { processed: 1, credited: 1 }
    } catch (err) {
      this.logger.error(
        `Failed to credit referral reward ${rr.id} for user ${referrerId}: ${errorMessage(err)}`,
      )
      return { processed: 1, credited: 0 }
    }
  }
}
