/**
 * TZ-02, соседний риск в том же файле: арифметика курса.
 *
 * 1) `estimate()` в проде раньше делал `String(Number(estimated_amount))` —
 *    round-trip через float терял формат: '0.00000001' превращалось в '1e-8',
 *    и эта строка уходила в exchange_rates (maintenance/update-rates). Курс
 *    теперь проходит валидацию Decimal'ом и остаётся строкой провайдера.
 * 2) `getEstimatePrice()` в dev-stub считал курс на `number` и держал свой
 *    словарь с TON/TRX/LTC. Заглушка переписана на DISPLAY_RUB_RATES + Decimal;
 *    она включается ТОЛЬКО при NODE_ENV !== 'production' И пустом ключе, т.е.
 *    в прод-контуре недостижима (условие зафиксировано тестом ниже).
 */
import { type ConfigService } from '@nestjs/config'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NOWPaymentsClient } from '../src/modules/payments/infrastructure/clients/nowpayments.client'

const PRODUCTION_CONFIG: Record<string, string> = {
  NODE_ENV: 'production',
  NOWPAYMENTS_API_KEY: 'test-api-key',
}

function makeClient(values: Record<string, string | undefined>): NOWPaymentsClient {
  const config = {
    get: (key: string): string | undefined => values[key],
  } as unknown as ConfigService
  return new NOWPaymentsClient(config)
}

/** Ответ GET /estimate с произвольным значением estimated_amount. */
function estimateResponse(estimatedAmount: unknown): unknown {
  return {
    ok: true,
    status: 200,
    json: async () => ({ estimated_amount: estimatedAmount }),
    text: async () => '',
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

describe('NOWPaymentsClient.estimate: курс остаётся строкой (prod-путь)', () => {
  it('маленький курс не теряет формат: 0.00000001 остаётся 0.00000001, а не 1e-8', async () => {
    const fetchMock = vi.fn().mockResolvedValue(estimateResponse('0.00000001'))
    vi.stubGlobal('fetch', fetchMock)
    const client = makeClient(PRODUCTION_CONFIG)

    const result = await client.estimate({ amount: '1', currencyFrom: 'RUB', currencyTo: 'BTC' })

    expect(result).toEqual({ estimatedAmount: '0.00000001', source: 'nowpayments' })
    expect(result?.estimatedAmount).not.toMatch(/e/)
  })

  it('обычный курс отдаётся дословно, запрос собран по тикерам провайдера', async () => {
    const fetchMock = vi.fn().mockResolvedValue(estimateResponse('92.54321'))
    vi.stubGlobal('fetch', fetchMock)
    const client = makeClient(PRODUCTION_CONFIG)

    const result = await client.estimate({
      amount: '1',
      currencyFrom: 'USDT_TRC20',
      currencyTo: 'RUB',
    })

    expect(result?.estimatedAmount).toBe('92.54321')
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('currency_from=usdttrc20')
    expect(url).toContain('currency_to=rub')
  })

  it.each([['abc'], ['0'], ['-1'], [''], [null], [undefined]])(
    'некорректный курс %j → null (fallback на DISPLAY_RUB_RATES), без исключения наружу',
    async (estimatedAmount) => {
      const fetchMock = vi.fn().mockResolvedValue(estimateResponse(estimatedAmount))
      vi.stubGlobal('fetch', fetchMock)
      const client = makeClient(PRODUCTION_CONFIG)

      await expect(
        client.estimate({ amount: '1', currencyFrom: 'BTC', currencyTo: 'RUB' }),
      ).resolves.toBeNull()
    },
  )
})

describe('NOWPaymentsClient: dev-stub курса недостижим в проде', () => {
  it('NODE_ENV=production + ключ → запрос идёт провайдеру, stub не используется', async () => {
    const fetchMock = vi.fn().mockResolvedValue(estimateResponse('93'))
    vi.stubGlobal('fetch', fetchMock)
    const client = makeClient(PRODUCTION_CONFIG)

    const estimate = await client.estimate({ amount: '1', currencyFrom: 'BTC', currencyTo: 'RUB' })
    const price = await client.getEstimatePrice({
      amount: '1',
      currencyFrom: 'BTC',
      currencyTo: 'RUB',
    })

    expect(estimate?.source).toBe('nowpayments')
    expect(price.estimatedAmount).toBe('93')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('production без ключа → fail-closed 503, а не stub', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const client = makeClient({ NODE_ENV: 'production' })

    await expect(
      client.getEstimatePrice({ amount: '1', currencyFrom: 'BTC', currencyTo: 'RUB' }),
    ).rejects.toThrow(/обязательные ключи/)
    expect(fetchMock).toHaveBeenCalledTimes(0)
  })
})

describe('NOWPaymentsClient.getEstimatePrice: dev-stub на Decimal', () => {
  const client = makeClient({ NODE_ENV: 'development' })

  it('арифметика строк/Decimal, результат — обычная десятичная запись', async () => {
    await expect(
      client.getEstimatePrice({ amount: '100', currencyFrom: 'USDT_TRC20', currencyTo: 'RUB' }),
    ).resolves.toEqual({ estimatedAmount: '9250.00' })
    await expect(
      client.getEstimatePrice({ amount: '0.0001', currencyFrom: 'BTC', currencyTo: 'RUB' }),
    ).resolves.toEqual({ estimatedAmount: '850.00' })
    await expect(
      client.getEstimatePrice({ amount: '92.5', currencyFrom: 'RUB', currencyTo: 'USDT_TRC20' }),
    ).resolves.toEqual({ estimatedAmount: '1.00000000' })
    await expect(
      client.getEstimatePrice({ amount: '1', currencyFrom: 'RUB', currencyTo: 'BTC' }),
    ).resolves.toEqual({ estimatedAmount: '0.00000012' })
  })

  /**
   * TON/TRX/LTC убраны из релиза (TZ-02): курса для них нет ни в словаре
   * провайдера, ни в DISPLAY_RUB_RATES — заглушка возвращает сумму без
   * конвертации (как и для любой другой неизвестной валюты).
   */
  it.each([['TON'], ['TRX'], ['LTC'], ['ETH']])(
    'валюты вне релизного набора (%s) не имеют курса в stub',
    async (currency) => {
      await expect(
        client.getEstimatePrice({ amount: '10', currencyFrom: currency, currencyTo: 'RUB' }),
      ).resolves.toEqual({ estimatedAmount: '10' })
      await expect(
        client.getEstimatePrice({ amount: '10', currencyFrom: 'RUB', currencyTo: currency }),
      ).resolves.toEqual({ estimatedAmount: '10' })
    },
  )

  it('estimate-заглушка: релизная валюта → константа, вне набора → null', async () => {
    await expect(
      client.estimate({ amount: '1', currencyFrom: 'USDT_TRC20', currencyTo: 'RUB' }),
    ).resolves.toEqual({ estimatedAmount: '92.5', source: 'np-dev-stub' })
    await expect(
      client.estimate({ amount: '1', currencyFrom: 'TON', currencyTo: 'RUB' }),
    ).resolves.toBeNull()
  })
})
