import { Injectable, Logger } from '@nestjs/common'

import { ReferralCalcService } from '../../referrals/application/referral-calc.service'

/**
 * Job `referral-daily` (GAP-32/33): ежедневный запуск реферальных начислений
 * (GGR-share) через ReferralCalcService.runDaily. Дедупликация внутри runDaily
 * (findReward по дню+валюте + idempotencyKey проводки) — повторный запуск за
 * тот же день не создаёт вторых проводок.
 *
 * Учёт вызовов: runDaily идемпотентен, тик раз в JOB_REFERRAL_DAILY_EVERY_MS
 * (default 24ч) — сбои видны в BullMQ (attempts) и логах сводки.
 */
@Injectable()
export class ReferralDailyJob {
  private readonly logger = new Logger(ReferralDailyJob.name)

  constructor(private readonly referralCalc: ReferralCalcService) {}

  async execute(dateStr?: string): Promise<{ processed: number; credited: number; date: Date; }> {
    const res = await this.referralCalc.runDaily(dateStr)
    this.logger.log(
      `referral-daily: date=${res.date.toISOString().slice(0, 10)} processed=${res.processed} credited=${res.credited}`,
    )
    return res
  }
}
