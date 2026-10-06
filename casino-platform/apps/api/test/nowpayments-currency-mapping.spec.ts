/**
 * TZ-02: релизный набор валют платёжного клиента NOWPayments.
 *
 * Проверяет три вещи:
 *  1) словарь тикеров покрывает ровно релизные валюты (geo.config.ts:3 —
 *     USDT_TRC20, BTC); ветки маппинга под TON/TRX/LTC, исключённые из релиза,
 *     в словаре отсутствуют;
 *  2) валюта вне набора отклоняется стабильным INVALID_CURRENCY (422) ДО любого
 *     обращения к провайдеру — и в проде (0 вызовов fetch), и в dev без ключа
 *     (dev-stub не эмулирует «платёж создан»);
 *  3) релизная валюта уходит провайдеру с корректным pay_currency, а принятое
 *     исключение по деньгам (price_amount — числом, решение В11) зафиксировано
 *     тестом, чтобы «чинка» не сломала контракт PSP.
 */
import { type ConfigService } from '@nestjs/config'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { InvalidCurrencyError } from '../src/modules/payments/domain/errors'
import {
  CRYPTO_PAY_CURRENCY_TICKERS,
  RELEASE_CRYPTO_CURRENCIES,
  assertReleaseCryptoCurrency,
  isReleaseCryptoCurrency,
} from '../src/modules/payments/domain/payment-currency.policy'
import { NOWPaymentsClient } from '../src/modules/payments/infrastructure/clients/nowpayments.client'
import { CreateCryptoDepositSchema } from '../src/modules/payments/presentation/dto/create-crypto-deposit.dto'

const PRODUCTION_CONFIG: Record<string, string> = {
  NODE_ENV: 'production',
  NOWPAYMENTS_API_KEY: 'test-api-key',
}

/** Fake ConfigService вместо real: клиент собирался бы наprocess.env-дефолтах. */
function makeClient(values: Record<string, string | undefined>): NOWPaymentsClient {
  const config = {
    get: (key: string): string | undefined => values[key],
  } as unknown as ConfigService
  return new NOWPaymentsClient(config)
}

/** Успешный ответ POST /payment: pay_currency эхом отдаём запрошенный тикер. */
function createdPaymentResponse(ticker: string): unknown {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      payment_id: 'np-777',
      pay_address: 'TAddress777',
      pay_amount: '99.9',
      pay_currency: ticker,
      expiration_estimate_date: '2026-10-03T00:00:00.000Z',
    }),
    text: async () => '',
  }
}

function createPaymentArgs(payCurrency: string) {
  return {
    priceAmount: '99.9',
    priceCurrency: 'USD',
    payCurrency,
    orderId: 'order-1',
    ipnCallbackUrl: 'https://example.test/ipn',
  }
}

/**
 * Валюты вне релизного набора: TON/TRX/LTC (исключены из релиза, TZ-02) и
 * мусор — чужие коды, RUB (служебная валюта курса, не платёжная), нижний
 * регистр, обрамление, пустая и заведомо длинная строка.
 */
const NOT_RELEASE_CURRENCIES = [
  'TON',
  'TRX',
  'LTC',
  'ETH',
  'USD',
  'RUB',
  'usdt_trc20',
  'btc',
  ' BTC',
  'BTC ',
  '',
  'currency-'.repeat(20),
]

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

/** Ловит InvalidCurrencyError от синхронного action (не проглатывая прочие). */
function captureCurrencyError(action: () => unknown): InvalidCurrencyError {
  try {
    action()
  } catch (error) {
    if (error instanceof InvalidCurrencyError) {
      return error
    }
    throw error
  }
  return expect.unreachable('ожидался InvalidCurrencyError')
}

describe('payment-currency.policy (TZ-02)', () => {
  it('таблица тикеров = ровно релизный набор, без TON/TRX/LTC', () => {
    expect(Object.keys(CRYPTO_PAY_CURRENCY_TICKERS).sort()).toEqual(['BTC', 'USDT_TRC20'])
    expect([...RELEASE_CRYPTO_CURRENCIES].sort()).toEqual(['BTC', 'USDT_TRC20'])
    for (const excluded of ['TON', 'TRX', 'LTC']) {
      expect(isReleaseCryptoCurrency(excluded)).toBe(false)
    }
  })

  it('релизные валюты проходят, регистр и обрамление значимы', () => {
    expect(isReleaseCryptoCurrency('USDT_TRC20')).toBe(true)
    expect(isReleaseCryptoCurrency('BTC')).toBe(true)
    expect(isReleaseCryptoCurrency('usdt_trc20')).toBe(false)
    expect(isReleaseCryptoCurrency('btc')).toBe(false)
    expect(isReleaseCryptoCurrency(' BTC')).toBe(false)
    expect(isReleaseCryptoCurrency('')).toBe(false)
  })

  it('assert возвращает валюту для релиза и INVALID_CURRENCY/422 для остального', () => {
    expect(assertReleaseCryptoCurrency('BTC')).toBe('BTC')
    const raised = captureCurrencyError(() => assertReleaseCryptoCurrency('TON'))
    expect(raised.code).toBe('INVALID_CURRENCY')
    expect(raised.httpStatus).toBe(422)
    expect(raised.context).toEqual({ currency: 'TON' })
  })

  it('вход в ошибке обрезан до 32 символов — echo не безразмерный', () => {
    const oversized = 'currency-'.repeat(20)
    const raised = captureCurrencyError(() => assertReleaseCryptoCurrency(oversized))
    expect(raised.context?.['currency']).toBe(oversized.slice(0, 32))
    expect(String(raised.context?.['currency'])).toHaveLength(32)
  })

  it('DTO депозита принимает релизные валюты и отвергает исключённые', () => {
    expect(CreateCryptoDepositSchema.safeParse({ amount: '10', currency: 'BTC' }).success).toBe(
      true,
    )
    expect(
      CreateCryptoDepositSchema.safeParse({ amount: '10', currency: 'USDT_TRC20' }).success,
    ).toBe(true)
    for (const rejected of ['TON', 'TRX', 'LTC', 'ton', '']) {
      expect(
        CreateCryptoDepositSchema.safeParse({ amount: '10', currency: rejected }).success,
      ).toBe(false)
    }
  })
})

describe('NOWPaymentsClient.mapCurrency', () => {
  const client = makeClient(PRODUCTION_CONFIG)

  it('релизные валюты и служебный RUB маппятся по словарю', () => {
    expect(client.mapCurrency('USDT_TRC20')).toBe('usdttrc20')
    expect(client.mapCurrency('BTC')).toBe('btc')
    expect(client.mapCurrency('RUB')).toBe('rub')
  })

  /**
   * Fallback toLowerCase() живёт только ради GET /estimate с display-фиатом
   * (UAH/BYN/KZT/UZS) — там запрашивается курс, платёж не создаётся. Для
   * pay_currency этот путь закрыт assert'ом в createPayment.
   */
  it('вне словаря — строчный fallback (estimate-пары), а не «поддержка» валюты', () => {
    expect(client.mapCurrency('UAH')).toBe('uah')
    expect(client.mapCurrency('KZT')).toBe('kzt')
    expect(client.mapCurrency('')).toBe('')
    expect(client.mapCurrency('TON')).toBe('ton')
    expect(isReleaseCryptoCurrency('TON')).toBe(false)
  })
})

describe('NOWPaymentsClient.createPayment: отклонение до обращения к провайдеру', () => {
  it.each(NOT_RELEASE_CURRENCIES)(
    'production: валюта %j → INVALID_CURRENCY, 0 вызовов fetch',
    async (currency) => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const client = makeClient(PRODUCTION_CONFIG)

      await expect(client.createPayment(createPaymentArgs(currency))).rejects.toBeInstanceOf(
        InvalidCurrencyError,
      )
      expect(fetchMock).toHaveBeenCalledTimes(0)
    },
  )

  it.each(NOT_RELEASE_CURRENCIES)(
    'dev без ключа: валюта %j → INVALID_CURRENCY, dev-stub не эмулирует платёж',
    async (currency) => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const client = makeClient({ NODE_ENV: 'development' })

      await expect(client.createPayment(createPaymentArgs(currency))).rejects.toBeInstanceOf(
        InvalidCurrencyError,
      )
      expect(fetchMock).toHaveBeenCalledTimes(0)
    },
  )

  it.each([
    ['USDT_TRC20', 'usdttrc20'],
    ['BTC', 'btc'],
  ])('релизная валюта %s доходит до провайдера с pay_currency=%s', async (currency, ticker) => {
    const fetchMock = vi.fn().mockResolvedValue(createdPaymentResponse(ticker))
    vi.stubGlobal('fetch', fetchMock)
    const client = makeClient(PRODUCTION_CONFIG)

    const result = await client.createPayment(createPaymentArgs(currency))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, { body?: string }]
    expect(url).toBe('https://api.nowpayments.io/v1/payment')
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.pay_currency).toBe(ticker)
    expect(body.price_currency).toBe('usd')
    // docs/PAYMENT_OVERVIEW.md, решение В11: контракт POST /payment требует
    // price_amount ЧИСЛОМ. Наше доменное поле — строка, здесь оно превращается
    // в число по спецификации провайдера. Тест фиксирует исключение, чтобы
    // «борьба с number» не сломала контракт PSP.
    expect(typeof body.price_amount).toBe('number')
    expect(body.price_amount).toBe(99.9)
    expect(result.payCurrency).toBe(ticker)
  })

  // use-case передаёт цену в той же монете, что и оплата (сумма в UI — это монеты),
  // поэтому our-имя USDT_TRC20 попадает и в price_currency. Провайдер принимает только
  // буквенно-цифровые тикеры: toLowerCase() подчёркивание не убирает, и платёж падал с
  // INVALID_REQUEST_PARAMS «price_currency must only contain alpha-numeric characters».
  it('цена в монете: USDT_TRC20 уходит провайдеру как usdttrc20, без подчёркивания', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createdPaymentResponse('usdttrc20'))
    vi.stubGlobal('fetch', fetchMock)
    const client = makeClient(PRODUCTION_CONFIG)

    await client.createPayment({
      ...createPaymentArgs('USDT_TRC20'),
      priceCurrency: 'USDT_TRC20',
    })

    const [, init] = fetchMock.mock.calls[0] as [string, { body?: string }]
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.price_currency).toBe('usdttrc20')
    expect(body.pay_currency).toBe('usdttrc20')
  })

  it('dev без ключа: релизная валюта отдаёт детерминированный stub без fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const client = makeClient({ NODE_ENV: 'development' })

    const result = await client.createPayment(createPaymentArgs('USDT_TRC20'))

    expect(fetchMock).toHaveBeenCalledTimes(0)
    expect(result.paymentId).toBe('np_order-1')
    expect(result.payCurrency).toBe('usdttrc20')
  })
})
