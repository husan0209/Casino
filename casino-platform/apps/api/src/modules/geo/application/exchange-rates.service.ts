import { Inject, Injectable, Logger } from '@nestjs/common'

import type { DisplayCurrency } from '@casino/shared-config'
import { DISPLAY_RUB_RATES } from '@casino/shared-config'
import { money } from '@casino/shared-utils'

/** Порт чтения курсов: Redis-кеш (TTL 5 мин) + последняя запись exchange_rates */
export interface IExchangeRatesReader {
  getCachedRates(): Promise<Record<string, string> | null>
  getLatestRate(
    currencyFrom: string,
  ): Promise<{ rate: string; fetchedAt: Date; source: string | null } | null>
}

export const EXCHANGE_RATES_READER = Symbol('EXCHANGE_RATES_READER')

export interface RubRate {
  rate: string
  source: 'redis-cache' | 'db' | 'static'
  stale: boolean
}

/** fetched_at старше 1 часа считается устаревшим (warn, но запрос не роняем) */
export const RATE_STALE_AFTER_MS = 60 * 60 * 1000

/**
 * GAP-34: конвертация display-валют из БД/кеша; DISPLAY_RUB_RATES — только fallback.
 * Деньги — только string/Prisma.Decimal.
 */
@Injectable()
export class ExchangeRatesService {
  private readonly logger = new Logger(ExchangeRatesService.name)

  constructor(@Inject(EXCHANGE_RATES_READER) private readonly reader: IExchangeRatesReader) {}

  async getRubRate(currency: DisplayCurrency): Promise<RubRate> {
    if (currency === 'RUB') {
      return { rate: '1', source: 'static', stale: false }
    }

    // 1) Redis-кеш (пишет UpdateRatesJob, ключ exchange_rates:rub, TTL 300 с)
    const cached = await this.reader.getCachedRates().catch(() => null)
    const fromCache = cached?.[currency]
    if (fromCache && money.isGreaterThan(fromCache, '0')) {
      return { rate: fromCache, source: 'redis-cache', stale: false }
    }

    // 2) последняя запись exchange_rates (append-only история)
    const latest = await this.reader.getLatestRate(currency).catch(() => null)
    if (latest) {
      const ageMs = Date.now() - latest.fetchedAt.getTime()
      const stale = ageMs > RATE_STALE_AFTER_MS
      if (stale) {
        this.logger.warn(
          `exchange_rate ${currency} stale (${Math.round(ageMs / 60000)} min) — использую всё равно`,
        )
      }
      return { rate: latest.rate, source: 'db', stale }
    }

    // 3) fallback — константы (static)
    return { rate: DISPLAY_RUB_RATES[currency] || '1', source: 'static', stale: false }
  }
}
