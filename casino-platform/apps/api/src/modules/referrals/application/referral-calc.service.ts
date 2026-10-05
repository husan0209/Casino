import { Inject, Injectable, Logger } from '@nestjs/common'
import { Decimal } from 'decimal.js'

import { errorMessage } from '@/common/utils/error-message'

import { type Currency } from '@casino/shared-types'
import { money } from '@casino/shared-utils'

import { WalletFacade } from '../../wallet/facade/wallet.facade'
import {
  type CurrencySumRow,
  type IReferralRepository,
  REFERRAL_REPOSITORY,
} from '../domain/referral.repository'

/**
 * Сводка суточного прогона: `processed` — записи referralReward, взятые прогоном
 * в работу (созданные сейчас + незавершённые начисления из compensation-прохода),
 * `credited` — из них реально зачислено на кошелёк. Счётчики записей, а не
 * деньги (AI_DEVELOPMENT_RULES §1), поэтому number законен.
 */
export interface ReferralDailyResult {
  processed: number
  credited: number
  date: Date
}

/**
 * Потолок compensation-прохода за один забег. Ограничение нужно, чтобы отказ
 * денежного контура на большом backlog не превращал суточный cron в
 * нескончаемый прогон: остаток добирается следующим тиком (проход идемпотентен).
 */
const PENDING_ACCRUAL_BATCH_SIZE = 200

@Injectable()
export class ReferralCalcService {
  private logger = new Logger(ReferralCalcService.name)

  constructor(
    @Inject(WalletFacade) private readonly walletFacade: WalletFacade,
    @Inject(REFERRAL_REPOSITORY) private readonly repo: IReferralRepository,
  ) {}

  async runDaily(dateStr?: string): Promise<ReferralDailyResult> {
    const date = dateStr ? new Date(dateStr) : new Date(Date.now() - 86400000)
    const dayStart = new Date(date)
    dayStart.setUTCHours(0, 0, 0, 0)
    const dayEnd = new Date(dayStart)
    dayEnd.setUTCHours(23, 59, 59, 999)
    const rewardRate = new Decimal(process.env['REFERRAL_REWARD_RATE'] || '0.05')
    // Компенсация ДО нового расчёта: начисления, у которых документ есть, а
    // проводка не прошла, иначе остались бы `pending` навсегда — дедуп по
    // кортежу суток посчитал бы их обработанными.
    const compensation = await this.retryPendingAccruals()
    // get all users with referrer
    const referredUsers = await this.repo.findReferredUsers()
    let processed = compensation.processed
    let credited = compensation.credited
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

  /**
   * Compensation-проход по начислениям в статусе `pending`.
   *
   * Повтор безопасен ровно в одном месте: `idempotencyKey` проводки выведен из
   * id записи награды (`ref_reward_<id>`), и ledger отдаёт `duplicate` вместо
   * второй выплаты (AI_DEVELOPMENT_RULES §2). Второй схемы дедупликации здесь
   * нет намеренно — дубль-ключ остаётся единственной защитой от двойной выплаты.
   */
  private async retryPendingAccruals(): Promise<{ processed: number; credited: number }> {
    const pendingRewards = await this.repo.findPendingRewards(PENDING_ACCRUAL_BATCH_SIZE)
    let processed = 0
    let credited = 0
    for (const reward of pendingRewards) {
      const rewardAmount = reward.rewardAmount.toString()
      if (!money.isPositive(rewardAmount)) {
        // Нулевая награда (GGR не положительный или доля меньше 1e-8) денежной
        // операции не имеет — ретраивать нечего, строка остаётся как аудит-след.
        continue
      }
      processed += 1
      const creditedNow = await this.creditReward({
        rewardId: reward.id,
        referrerId: reward.referrerId,
        referredId: reward.referredId,
        currency: reward.currency,
        amount: rewardAmount,
        periodStart: reward.periodStart,
      })
      if (creditedNow) {
        credited += 1
      }
    }
    if (processed > 0) {
      this.logger.log(
        `Referral compensation pass: pending=${processed} credited=${credited} batch=${PENDING_ACCRUAL_BATCH_SIZE}`,
      )
    }
    return { processed, credited }
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
    const bets = await this.repo.sumTransactions({
      userId: referredId,
      type: 'bet',
      from: dayStart,
      to: dayEnd,
    })
    const wins = await this.repo.sumTransactions({
      userId: referredId,
      type: 'win',
      from: dayStart,
      to: dayEnd,
    })
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
      // Строка суток уже есть — повторного кредитования здесь НЕ будет намеренно:
      // незавершённые (`pending`) добирает compensation-проход в начале runDaily,
      // и делает это по тому же idempotencyKey. Попытка ретраить тут означала бы
      // вторую схему дедупликации поверх ledger-ключа.
      return { processed: 0, credited: 0 }
    }

    const createdReward = await this.repo.createReward({
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
    const creditedNow = await this.creditReward({
      rewardId: createdReward.id,
      referrerId,
      referredId,
      currency: cur,
      amount: rewardAmount,
      periodStart: dayStart,
    })
    return { processed: 1, credited: creditedNow ? 1 : 0 }
  }

  /**
   * Кредитование одной записи награды и перевод её в `credited` — общий шаг
   * для свежего начисления и для compensation-повтора. Отказ проводки
   * не роняет прогон: статус остаётся `pending`, и строка уходит на повтор
   * при следующем забеге (см. retryPendingAccruals).
   */
  private async creditReward(args: {
    rewardId: string
    referrerId: string
    referredId: string
    currency: string
    amount: string
    periodStart: Date
  }): Promise<boolean> {
    const { rewardId, referrerId, referredId, currency, amount, periodStart } = args
    try {
      await this.walletFacade.credit({
        userId: referrerId,
        currency: currency as Currency,
        amount,
        type: 'REFERRAL_REWARD', // enum LedgerEntryType (было 'referral_reward' — не из enum)
        idempotencyKey: `ref_reward_${rewardId}`,
        description: `Referral reward for ${referredId} (${periodStart.toISOString().slice(0, 10)})`,
        metadata: { referralRewardId: rewardId, referredId },
      })
      await this.repo.updateReward(rewardId, { status: 'credited', creditedAt: new Date() })
      return true
    } catch (err) {
      this.logger.error(
        `Failed to credit referral reward ${rewardId} for user ${referrerId}: ${errorMessage(err)}`,
      )
      return false
    }
  }
}
