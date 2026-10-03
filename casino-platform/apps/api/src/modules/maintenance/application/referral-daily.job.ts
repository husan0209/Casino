import { Inject, Injectable, Logger } from '@nestjs/common'

import { ReferralsFacade } from '../../referrals/facade/referrals.facade'

/**
 * Job `referral-daily` (GAP-32/33): ежедневный запуск реферальных начислений
 * (GGR-share) через ReferralsFacade.runDaily. Дедупликация внутри runDaily
 * (findReward по дню+валюте + idempotencyKey проводки) — повторный запуск за
 * тот же день не создаёт вторых проводок.
 *
 * Учёт вызовов: runDaily идемпотентен, тик раз в JOB_REFERRAL_DAILY_EVERY_MS
 * (default 24ч) — сбои видны в BullMQ (attempts) и логах сводки.
 *
 * Межмодульный контур — только через фасад referrals (В1/В6): раньше джоб
 * импортировал ReferralCalcService из `referrals/application/` напрямую.
 */
@Injectable()
export class ReferralDailyJob {
  private readonly logger = new Logger(ReferralDailyJob.name)

  constructor(@Inject(ReferralsFacade) private readonly referrals: ReferralsFacade) {}

  async execute(dateStr?: string): Promise<{ processed: number; credited: number; date: Date }> {
    const result = await this.referrals.runDaily(dateStr)
    this.logger.log(
      `referral-daily: date=${result.date.toISOString().slice(0, 10)} processed=${result.processed} credited=${result.credited}`,
    )
    return result
  }
}
