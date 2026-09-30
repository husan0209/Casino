/**
 * Job `affiliate-daily` (ТЗ ч.8 §15): ежедневный расчёт RevShare партнёрам.
 *
 * Отдельно от `referral-daily`, потому что считает ДРУГОЕ: NGR вместо GGR и
 * индивидуальные ставки вместо общих 5%. Оба джоба идемпотентны и могут
 * сработать в одну ночь независимо.
 *
 * Идемпотентность (ТЗ ч.8 §15): уникальный индекс
 * (affiliate, player, period_start, currency) в affiliate_commissions отсекает
 * дубль, idempotencyKey `aff_{commissionId}` — двойной кредит. Повторный
 * запуск (ретрай, рестарт воркера, ручной триггер поверх автоматического)
 * безопасен.
 */
import { Inject, Injectable, Logger } from '@nestjs/common'

import { AffiliateFacade } from '../../affiliate/facade/affiliate.facade'

@Injectable()
export class AffiliateDailyJob {
  private readonly logger = new Logger(AffiliateDailyJob.name)

  constructor(@Inject(AffiliateFacade) private readonly affiliateFacade: AffiliateFacade) {}

  async execute(dateStr?: string): Promise<{
    date: string
    processed: number
    created: number
    credited: number
    errors: number
  }> {
    const result = await this.affiliateFacade.runDaily(dateStr)
    this.logger.log(
      `affiliate-daily: date=${result.date} processed=${result.processed} created=${result.created} credited=${result.credited} errors=${result.errors.length}`,
    )
    return {
      date: result.date,
      processed: result.processed,
      created: result.created,
      credited: result.credited,
      errors: result.errors.length,
    }
  }
}
