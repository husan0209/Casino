import { Inject, Injectable, Logger } from '@nestjs/common'

import { errorMessage } from '@/common/utils/error-message'

import { DISPLAY_RUB_RATES } from '@casino/shared-config'

import {
  EXCHANGE_RATE_WRITER,
  RATES_PROVIDER,
  type IExchangeRateWriter,
  type IRatesProvider,
  type RatesResult,
} from '../domain/maintenance.ports'

const HISTORY_TTL_MS = 7 * 86_400_000

/**
 * Job `update-rates` (GAP-33, ТЗ ч.3 §13): каждые JOB_UPDATE_RATES_EVERY_MS
 * (default 5 мин) обновляет курсы RUB для display-валют:
 * - крипто (USDT_TRC20/BTC) — через RATES_PROVIDER (NOWPayments /estimate;
 *   в dev без ключа — детерминированный dev-stub);
 * - фиат (UAH/BYN/KZT/UZS) — внешнего источника в MVP нет: пишутся константы
 *   DISPLAY_RUB_RATES с source='static' (честно помечены, не рыночные).
 * Запись: exchange_rates (source, fetched_at) + Redis-кеш TTL 5 мин (best-effort
 * через writer). Потребители таблицы переключаются с констант в GAP-34.
 */
@Injectable()
export class UpdateRatesJob {
  private readonly logger = new Logger(UpdateRatesJob.name)

  constructor(
    @Inject(EXCHANGE_RATE_WRITER) private readonly writer: IExchangeRateWriter,
    @Inject(RATES_PROVIDER) private readonly provider: IRatesProvider,
  ) {}

  async execute(now = new Date()): Promise<RatesResult> {
    let updated = 0
    let skipped = 0
    let source = 'static'
    const cached: Record<string, string> = {}

    for (const currency of Object.keys(DISPLAY_RUB_RATES)) {
      if (currency === 'RUB') {
        continue // 1:1, в таблицу не пишем
      }
      // Сбой провайдера по одной валюте не отменяет остальные: fallback на константу
      const live = await this.provider.estimateRub(currency).catch(() => null)
      const rate =
        live && Number.isFinite(Number(live.rate)) && Number(live.rate) > 0
          ? live
          : { rate: DISPLAY_RUB_RATES[currency as keyof typeof DISPLAY_RUB_RATES], source: 'static' }
      if (rate.source !== 'static') {
        source = rate.source
      }
      try {
        await this.writer.saveRate({
          currencyFrom: currency,
          currencyTo: 'RUB',
          rate: rate.rate,
          source: rate.source,
        })
        cached[currency] = rate.rate
        updated++
      } catch (e) {
        this.logger.error(`update-rates: ${currency} save failed: ${errorMessage(e)}`)
        skipped++
      }
    }

    await this.pruneHistory(now)
    await this.writer.cacheRates(cached).catch((e: Error) =>
      this.logger.warn(`update-rates: redis cache skipped: ${e.message}`),
    )
    this.logger.log(`update-rates: updated=${updated} skipped=${skipped} source=${source}`)
    return { updated, skipped, source }
  }

  /** Таблица чистится от записей старше недели (тики каждые 5 мин — иначе бесконечный рост). */
  private async pruneHistory(now: Date): Promise<void> {
    const { prisma } = await import('@casino/database')
    await prisma.exchangeRate
      .deleteMany({ where: { fetchedAt: { lt: new Date(now.getTime() - HISTORY_TTL_MS) } } })
      .catch(() => this.logger.warn('update-rates: history prune failed (non-fatal)'))
  }
}
