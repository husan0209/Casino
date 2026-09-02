import { beforeEach, describe, expect, it, vi } from 'vitest'

// Мок БД ДО импорта SUT (PrismaExchangeRatesReader импортирует prisma синглтон)
vi.mock('@casino/database', () => ({
  prisma: { exchangeRate: { findFirst: vi.fn() } },
}))

import {
  ExchangeRatesService,
  RATE_STALE_AFTER_MS,
} from '@modules/geo/application/exchange-rates.service'
import { GetGeoConfigUseCase } from '@modules/geo/application/use-cases/get-geo-config.use-case'
import { convertRubToDisplayAmount } from '@modules/geo/domain/geo-config.policy'
import { GeoFacade } from '@modules/geo/facade/geo.facade'
import { PrismaExchangeRatesReader } from '@modules/geo/infrastructure/exchange-rates.prisma.reader'
import { GetKycStatusUseCase } from '@modules/kyc/application/use-cases/get-kyc-status.use-case'

import { prisma } from '@casino/database'

const findFirst = vi.mocked(prisma.exchangeRate.findFirst)

/** Reader без Redis (ConfigService без REDIS_URL) — только БД + fallback */
function makeReader(): PrismaExchangeRatesReader {
  return new PrismaExchangeRatesReader({ get: () => undefined } as never)
}

describe('ExchangeRatesService (GAP-34)', () => {
  beforeEach(() => {
    findFirst.mockReset()
  })

  it('RUB — всегда static 1, чтения источников нет', async () => {
    const svc = new ExchangeRatesService(makeReader())
    const res = await svc.getRubRate('RUB')
    expect(res).toEqual({ rate: '1', source: 'static', stale: false })
    expect(findFirst).not.toHaveBeenCalled()
  })

  it('свежая запись из exchange_rates → source db, stale false', async () => {
    findFirst.mockResolvedValue({
      rate: { toString: () => '95.123' },
      fetchedAt: new Date(),
      source: 'np-dev-stub',
    } as never)
    const svc = new ExchangeRatesService(makeReader())
    const res = await svc.getRubRate('USDT_TRC20')
    expect(res).toEqual({ rate: '95.123', source: 'db', stale: false })
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { currencyFrom: 'USDT_TRC20', currencyTo: 'RUB' } }),
    )
  })

  it('запись старше RATE_STALE_AFTER_MS → stale true, но курс используется', async () => {
    findFirst.mockResolvedValue({
      rate: { toString: () => '94' },
      fetchedAt: new Date(Date.now() - RATE_STALE_AFTER_MS - 60_000),
      source: 'nowpayments',
    } as never)
    const svc = new ExchangeRatesService(makeReader())
    const res = await svc.getRubRate('USDT_TRC20')
    expect(res).toEqual({ rate: '94', source: 'db', stale: true })
  })

  it('нет записей в БД → fallback на константы DISPLAY_RUB_RATES', async () => {
    findFirst.mockResolvedValue(null)
    const svc = new ExchangeRatesService(makeReader())
    const usdt = await svc.getRubRate('USDT_TRC20')
    expect(usdt).toEqual({ rate: '92.5', source: 'static', stale: false })
    const btc = await svc.getRubRate('BTC')
    expect(btc).toEqual({ rate: '8500000', source: 'static', stale: false })
  })

  it('сбой чтения БД → fallback static, запрос не роняем', async () => {
    findFirst.mockRejectedValue(new Error('db down'))
    const svc = new ExchangeRatesService(makeReader())
    const res = await svc.getRubRate('UAH')
    expect(res).toEqual({ rate: '2.5', source: 'static', stale: false })
  })

  it('Redis-кеш приоритетнее БД', async () => {
    const fakeReader = {
      getCachedRates: vi.fn().mockResolvedValue({ USDT_TRC20: '95.9' }),
      getLatestRate: vi.fn().mockResolvedValue({ rate: '94', fetchedAt: new Date(), source: 'db' }),
    }
    const svc = new ExchangeRatesService(fakeReader as never)
    const res = await svc.getRubRate('USDT_TRC20')
    expect(res).toEqual({ rate: '95.9', source: 'redis-cache', stale: false })
    expect(fakeReader.getLatestRate).not.toHaveBeenCalled()
  })

  it('некорректный кеш (<=0) → идём в БД', async () => {
    const fakeReader = {
      getCachedRates: vi.fn().mockResolvedValue({ USDT_TRC20: '0' }),
      getLatestRate: vi.fn().mockResolvedValue({ rate: '94.4', fetchedAt: new Date(), source: 'db' }),
    }
    const svc = new ExchangeRatesService(fakeReader as never)
    const res = await svc.getRubRate('USDT_TRC20')
    expect(res).toEqual({ rate: '94.4', source: 'db', stale: false })
  })
})

/** Фейковый KYC-репо: статус без KYC, депозиты 0 */
function makeKycRepo(): never {
  return {
    getStatus: async () => ({ kyc_status: 'unverified' }),
    getTotalDepositedRub: async () => '0',
  } as never
}

describe('критерий 3: курс меняет limit_remaining в ответе KYC-API', () => {
  function makeUseCase(rate: string | null): GetKycStatusUseCase {
    const reader = {
      getCachedRates: vi.fn().mockResolvedValue(null),
      getLatestRate: rate
        ? vi.fn().mockResolvedValue({ rate, fetchedAt: new Date(), source: 'test' })
        : vi.fn().mockResolvedValue(null),
    }
    const facade = new GeoFacade(new GetGeoConfigUseCase({} as never), new ExchangeRatesService(reader as never))
    return new GetKycStatusUseCase(makeKycRepo(), facade, { get: () => '5000' } as never)
  }

  it('курс 4000 из БД → 5000 RUB = 1.25 USDT', async () => {
    const res = await makeUseCase('4000').execute('user-1', 'USDT_TRC20')
    expect(res.limit_remaining).toBe('1.25')
    expect(res.limit_currency).toBe('USDT_TRC20')
  })

  it('без записи в БД → старое значение по константе 92.5 (54.05 USDT)', async () => {
    const res = await makeUseCase(null).execute('user-1', 'USDT_TRC20')
    expect(res.limit_remaining).toBe('54.05')
  })
})

describe('convertRubToDisplayAmount с rateOverride (GAP-34)', () => {
  it('override из БД вытесняет константу', () => {
    expect(convertRubToDisplayAmount('9250', 'USDT_TRC20', '95')).toBe('97.36')
  })

  it('без override — поведение прежнее (константы)', () => {
    expect(convertRubToDisplayAmount('25', 'UAH')).toBe('10')
  })

  it('BTC — 8 знаков максимум (0.2 → "0.2", хвостовые нули не дописываются)', () => {
    expect(convertRubToDisplayAmount('1000000', 'BTC', '5000000')).toBe('0.2')
  })

  it('RUB — без конвертации', () => {
    expect(convertRubToDisplayAmount('555.5', 'RUB', '999')).toBe('555.5')
  })
})
