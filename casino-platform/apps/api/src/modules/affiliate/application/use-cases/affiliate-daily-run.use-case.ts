/**
 * Суточный расчёт RevShare (UC-AFF-11, ТЗ ч.8 §15).
 *
 * ОРКЕСТРАЦИЯ, а не логика: обходит квалифицированные атрибуции, по каждой
 * собирает валюты и вызывает UC-AFF-09 (создать) → UC-AFF-10 (зачислить).
 *
 * ИДЕМПОТЕНТНОСТЬ. Каждый шаг идемпотентен сам по себе:
 *  - атрибуции выбираются постранично по id, повторный запуск не дублирует;
 *  - UC-AFF-09 проверяет уникальный индекс (affiliate, player, period, ccy);
 *  - UC-AFF-10 использует idempotencyKey `aff_{commissionId}`.
 * Поэтому повторный запуск за тот же период безопасен — а это штатная
 * ситуация (ручной триггер после автоматического, рестарт воркера).
 */
import { Inject, Injectable, Logger } from '@nestjs/common'

import { errorMessage } from '@/common/utils/error-message'

import { collectCurrencies, CreateCommissionUseCase } from './create-commission.use-case'
import { CreditCommissionUseCase } from './credit-commission.use-case'
import {
  AFFILIATE_ATTRIBUTION_REPOSITORY,
  AFFILIATE_GAME_ACTIVITY_REPOSITORY,
  type AffiliateAttributionRepository,
  type AttributionForCalc,
  type GameActivityRepository,
} from '../../domain/repositories/affiliate.repository'

/** Размер страницы при обходе атрибуций — баланс памяти и round-trip'ов. */
const ATTRIBUTION_PAGE_SIZE = 200

/** Период расчёта: границы суток UTC. */
interface DailyPeriod {
  periodStart: Date
  periodEnd: Date
}

export interface AffiliateDailyRunResult {
  date: string
  /** Атрибуций обработано. */
  processed: number
  /** Начислений создано. */
  created: number
  /** Начислений зачислено на кошелёк партнёра. */
  credited: number
  /** Пропущено из-за уже существующего начисления. */
  skippedDuplicates: number
  /** Пропущено: NGR <= 0. */
  skippedNegativeNgr: number
  /** Ошибки отдельных начислений — прогон не прерывается. */
  errors: string[]
}

/** Период = календарные сутки UTC, как у существующего referral-daily. */
export function resolvePeriod(dateStr?: string): DailyPeriod {
  const base = dateStr !== undefined ? new Date(dateStr) : new Date(Date.now() - 86400000)
  const periodStart = new Date(base)
  periodStart.setUTCHours(0, 0, 0, 0)
  const periodEnd = new Date(periodStart)
  periodEnd.setUTCHours(23, 59, 59, 999)
  return { periodStart, periodEnd }
}

@Injectable()
export class AffiliateDailyRunUseCase {
  private readonly logger = new Logger(AffiliateDailyRunUseCase.name)

  // eslint-disable-next-line max-params -- Nest DI: состав конструктора задаётся графом зависимостей (GAP-25)
  constructor(
    @Inject(AFFILIATE_ATTRIBUTION_REPOSITORY)
    private readonly attributions: AffiliateAttributionRepository,
    @Inject(AFFILIATE_GAME_ACTIVITY_REPOSITORY)
    private readonly activity: GameActivityRepository,
    @Inject(CreateCommissionUseCase) private readonly createCommission: CreateCommissionUseCase,
    @Inject(CreditCommissionUseCase) private readonly creditCommission: CreditCommissionUseCase,
  ) {}

  async execute(dateStr?: string): Promise<AffiliateDailyRunResult> {
    const period = resolvePeriod(dateStr)
    const result: AffiliateDailyRunResult = {
      date: period.periodStart.toISOString().slice(0, 10),
      processed: 0,
      created: 0,
      credited: 0,
      skippedDuplicates: 0,
      skippedNegativeNgr: 0,
      errors: [],
    }

    let page = 1
    for (;;) {
      const batch = await this.attributions.listQualifiedForCalc({
        until: period.periodEnd,
        page,
        perPage: ATTRIBUTION_PAGE_SIZE,
      })
      if (batch.items.length === 0) {
        break
      }
      for (const item of batch.items) {
        await this.processAttribution(item, period, result)
      }
      if (batch.items.length < ATTRIBUTION_PAGE_SIZE) {
        break
      }
      page += 1
    }

    this.logger.log(
      `affiliate-daily: date=${result.date} processed=${result.processed} created=${result.created} credited=${result.credited} errors=${result.errors.length}`,
    )
    return result
  }

  private async processAttribution(
    item: AttributionForCalc,
    period: DailyPeriod,
    result: AffiliateDailyRunResult,
  ): Promise<void> {
    result.processed += 1
    let currencies: string[]
    try {
      currencies = await collectCurrencies(this.activity, {
        playerId: item.playerId,
        from: period.periodStart,
        to: period.periodEnd,
      })
    } catch (err) {
      result.errors.push(`activity ${item.playerId}: ${errorMessage(err)}`)
      return
    }

    for (const currency of currencies) {
      try {
        await this.processCurrency(item, currency, period, result)
      } catch (err) {
        // Одна монета/игрок не должна ронять весь прогон: остальные начисления
        // всё равно корректны, а упавшее будет повторено в следующем цикле.
        result.errors.push(`${item.playerId}/${currency}: ${errorMessage(err)}`)
      }
    }
  }

  // eslint-disable-next-line max-params -- аргументы задаются предметной областью: атрибуция + валюта + период + накопитель
  private async processCurrency(
    item: AttributionForCalc,
    currency: string,
    period: DailyPeriod,
    result: AffiliateDailyRunResult,
  ): Promise<void> {
    const outcome = await this.createCommission.executeForCurrency(
      {
        affiliateId: item.affiliateId,
        playerId: item.playerId,
        attributionId: item.attributionId,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
      },
      currency,
    )
    if (outcome.status !== 'created') {
      this.countSkip(outcome.status, result)
      return
    }

    result.created += 1
    const credit = await this.creditCommission.executeSafe({ commissionId: outcome.commissionId })
    if (credit.status === 'credited') {
      result.credited += 1
    }
  }

  /**
   * Учёт пропусков. Различает «уже было посчитано» и «NGR ≤ 0»: для партнёра
   * и для оператора это разные ситуации, и в статистике они должны различаться.
   */
  private countSkip(
    status: 'skipped_duplicate' | 'skipped_negative_ngr',
    result: AffiliateDailyRunResult,
  ): void {
    if (status === 'skipped_duplicate') {
      result.skippedDuplicates += 1
      return
    }
    result.skippedNegativeNgr += 1
  }
}
