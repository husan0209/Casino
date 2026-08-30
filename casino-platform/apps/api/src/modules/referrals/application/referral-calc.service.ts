import { Injectable, Logger } from '@nestjs/common'
import Decimal from 'decimal.js'

import { prisma } from '@casino/database'
import type { Currency } from '@casino/shared-types'
import { money } from '@casino/shared-utils'

import { WalletFacade } from '../../wallet/application/wallet.facade'

@Injectable()
export class ReferralCalcService {
  private logger = new Logger(ReferralCalcService.name)

  constructor(private readonly walletFacade: WalletFacade) {}

  // TODO(referrals): split runDaily into accrual + payout steps (<60 lines)
  // eslint-disable-next-line max-lines-per-function
  async runDaily(dateStr?: string) {
    const date = dateStr ? new Date(dateStr) : new Date(Date.now() - 86400000)
    const dayStart = new Date(date)
    dayStart.setUTCHours(0, 0, 0, 0)
    const dayEnd = new Date(dayStart)
    dayEnd.setUTCHours(23, 59, 59, 999)
    const rewardRate = new Decimal(process.env['REFERRAL_REWARD_RATE'] || '0.05')
    // get all users with referrer
    const referredUsers = await prisma.user.findMany({
      where: { referredBy: { not: null } },
      select: { id: true, referredBy: true },
    })
    let processed = 0
    let credited = 0
    for (const ru of referredUsers) {
      if (!ru.referredBy) {
        continue
      }
      const res = await this.processUserRewards(ru.id, ru.referredBy!, dayStart, dayEnd, rewardRate)
      processed += res.processed
      credited += res.credited
    }
    this.logger.log(
      `Referral daily: processed=${processed} credited=${credited} date=${dayStart.toISOString().slice(0, 10)}`,
    )
    return { processed, credited, date: dayStart }
  }

  /** GGR-share за сутки по всем валютам игрока: создаёт referralReward и кредитует награду рефереру. */
  // eslint-disable-next-line max-lines-per-function -- single cohesive unit: group bets/wins per currency, accrue, credit
  private async processUserRewards(
    referredId: string,
    referrerId: string,
    dayStart: Date,
    dayEnd: Date,
    rewardRate: Decimal,
  ): Promise<{ processed: number; credited: number }> {
    const bets = await prisma.gameTransaction.groupBy({
      by: ['currency'],
      where: { userId: referredId, type: 'bet', createdAt: { gte: dayStart, lte: dayEnd } },
      _sum: { amount: true },
    })
    const wins = await prisma.gameTransaction.groupBy({
      by: ['currency'],
      where: { userId: referredId, type: 'win', createdAt: { gte: dayStart, lte: dayEnd } },
      _sum: { amount: true },
    })
    const currencies = new Set<string>([
      ...bets.map((b: { currency: string }) => b.currency),
      ...wins.map((w: { currency: string }) => w.currency),
    ])

    let processed = 0
    let credited = 0
    for (const cur of currencies) {
      const betSum = bets.find((b: { currency: string }) => b.currency === cur)?._sum.amount ?? '0'
      const winSum = wins.find((w: { currency: string }) => w.currency === cur)?._sum.amount ?? '0'
      const ggr = new Decimal(betSum).minus(winSum)
      const isPositiveGgr = ggr.gt(0)
      const status = isPositiveGgr ? 'pending' : 'zero'
      const rewardAmount = isPositiveGgr ? ggr.times(rewardRate).toFixed(8) : '0'

      const exists = await prisma.referralReward.findFirst({
        where: { referrerId, referredId, periodStart: dayStart, currency: cur },
      })
      if (exists) {
        continue
      }

      const rr = await prisma.referralReward.create({
        data: {
          referrerId,
          referredId,
          type: 'ggr_share',
          periodStart: dayStart,
          periodEnd: dayEnd,
          ggrAmount: isPositiveGgr ? ggr.toFixed(8) : '0',
          rewardRate: rewardRate.toFixed(4),
          rewardAmount,
          currency: cur,
          status: status as any,
        },
      })
      processed++

      if (!isPositiveGgr || !money.isPositive(rewardAmount)) {
        continue
      }
      try {
        await this.walletFacade.credit({
          userId: referrerId,
          currency: cur as Currency,
          amount: rewardAmount,
          type: 'referral_reward',
          idempotencyKey: `ref_reward_${rr.id}`,
          description: `Referral reward for ${referredId} (${dayStart.toISOString().slice(0, 10)})`,
          metadata: { referralRewardId: rr.id, referredId },
        })
        await prisma.referralReward.update({
          where: { id: rr.id },
          data: { status: 'credited', creditedAt: new Date() },
        })
        credited++
      } catch (err: any) {
        this.logger.error(
          `Failed to credit referral reward ${rr.id} for user ${referrerId}: ${err?.message || err}`,
        )
      }
    }
    return { processed, credited }
  }
}
