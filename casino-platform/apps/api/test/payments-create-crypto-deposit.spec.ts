/**
 * Юнит-тесты CreateCryptoDepositUseCase (G21).
 *
 * Пайплайн: проверка релизной валюты (TZ-02, домен → @casino/shared-config) →
 * RUB-оценка через NOWPayments → KYC-лимит → NP createPayment → заявка в БД
 * (pay_address в metadata). Ошибка NP оборачивается в PaymentProviderError,
 * заявка до БД не доезжает; AppError из клиента наружу идёт без изменений.
 */
import { vi } from 'vitest'

import { CreateCryptoDepositUseCase } from '../src/modules/payments/application/use-cases/create-crypto-deposit.use-case'
import {
  InvalidCurrencyError,
  KycRequiredError,
  PaymentProviderError,
} from '../src/modules/payments/domain/errors'

import type {
  INowPaymentsClient,
  IPaymentRequestRepository,
  PaymentRequest,
} from '../src/modules/payments/domain/payments.ports'

const NP_PAYMENT = {
  paymentId: 'np-1',
  payAddress: 'TAddr123',
  payAmount: '99.9',
  payCurrency: 'USDT_TRC20',
  expirationEstimateDate: '2026-10-03T00:00:00.000Z',
}

type CreatedRow = Record<string, unknown>

function makeDeps(over: { npError?: Error } = {}) {
  const created: CreatedRow[] = []
  const kycCalls: Array<{ userId: string; rub: string }> = []
  // Аргументы createPayment раньше не захватывались: тест проверял только результат,
  // поэтому priceCurrency='USD' при сумме в монетах проходил как зелёный.
  const paymentCalls: Array<Record<string, unknown>> = []

  const repo = {
    create: async (data: CreatedRow) => {
      created.push(data)
      return { id: 'pr-1' } as unknown as PaymentRequest
    },
  } as unknown as IPaymentRequestRepository

  const np: INowPaymentsClient = {
    getEstimatePrice: async () => ({ estimatedAmount: '12345.5' }),
    createPayment: async (params: {
      priceAmount: string
      priceCurrency: string
      payCurrency: string
    }) => {
      paymentCalls.push({ ...params })
      if (over.npError) {
        throw over.npError
      }
      return NP_PAYMENT
    },
  } as unknown as INowPaymentsClient

  const kyc = {
    assertCanDeposit: async (userId: string, newDepositRub: string) => {
      kycCalls.push({ userId, rub: newDepositRub })
    },
  } as never

  const config = { get: () => undefined } as never

  const uc = new CreateCryptoDepositUseCase(repo, np, kyc, config)
  return { uc, created, kycCalls, paymentCalls }
}

describe('CreateCryptoDepositUseCase', () => {
  it('happy path: NP-платёж создан, заявка с metadata и RUB-оценкой, поля отданы игроку', async () => {
    const d = makeDeps()
    const res = await d.uc.execute('u-1', '99.9', 'USDT_TRC20')

    expect(d.kycCalls).toEqual([{ userId: 'u-1', rub: '12345.5' }])
    const row = d.created[0]!
    expect(row.userId).toBe('u-1')
    expect(row.type).toBe('deposit')
    expect(row.status).toBe('pending')
    expect(row.provider).toBe('nowpayments')
    expect(row.amountRub).toBe('12345.5')
    expect(row.externalId).toBe('np-1')
    expect(row.metadata).toEqual({
      pay_address: 'TAddr123',
      pay_amount: '99.9',
      pay_currency: 'USDT_TRC20',
    })
    expect(res).toEqual({
      payment_request_id: 'pr-1',
      pay_address: 'TAddr123',
      pay_amount: '99.9',
      pay_currency: 'USDT_TRC20',
      expires_at: '2026-10-03T00:00:00.000Z',
    })
    // Цена инвойса обязана быть в валюте оплаты: `amount` — это монеты, а не доллары.
    expect(d.paymentCalls).toHaveLength(1)
    expect(d.paymentCalls[0]).toMatchObject({
      priceAmount: '99.9',
      priceCurrency: 'USDT_TRC20',
      payCurrency: 'USDT_TRC20',
    })
  })

  // Регрессия: при priceCurrency='USD' NOWPayments считал цену в долларах и на
  // «0.0005 BTC» выдавал AMOUNT_MINIMAL_ERROR (1e-8 BTC), то есть любой BTC-депозит
  // был невозможен. USDT скрывал это курсом 1:1, поэтому случай нужен именно BTC.
  it('BTC: сумма в монетах уходит ценой в монетах, а не в USD', async () => {
    const d = makeDeps()
    await d.uc.execute('u-1', '0.0005', 'BTC')

    expect(d.paymentCalls[0]).toMatchObject({
      priceAmount: '0.0005',
      priceCurrency: 'BTC',
      payCurrency: 'BTC',
    })
  })

  it('валюта вне whitelist → InvalidCurrencyError, NP не дёргается', async () => {
    const d = makeDeps()
    await expect(d.uc.execute('u-1', '100', 'USD')).rejects.toThrow(InvalidCurrencyError)
    expect(d.created).toHaveLength(0)
    expect(d.kycCalls).toHaveLength(0)
  })

  it('KYC-лимит исчерпан → KycRequiredError до createPayment (заявки и NP-платежа нет)', async () => {
    const np = {
      getEstimatePrice: async () => ({ estimatedAmount: '999999' }),
      createPayment: async () => {
        throw new Error('must not be called')
      },
    } as unknown as INowPaymentsClient
    const kyc = {
      assertCanDeposit: async () => {
        throw new KycRequiredError()
      },
    } as never
    const repo = {
      create: async () => {
        throw new Error('must not be called')
      },
    } as unknown as IPaymentRequestRepository

    const uc = new CreateCryptoDepositUseCase(repo, np, kyc, { get: () => undefined } as never)
    await expect(uc.execute('u-1', '100', 'BTC')).rejects.toThrow(KycRequiredError)
  })

  it('NOWPayments упал на createPayment → PaymentProviderError, заявка не создана', async () => {
    const d = makeDeps({ npError: new Error('np down') })
    await expect(d.uc.execute('u-1', '99.9', 'USDT_TRC20')).rejects.toThrow(PaymentProviderError)
    expect(d.created).toHaveLength(0)
  })
})

/**
 * TZ-02: релизный набор валют задаёт domain/payment-currency.policy (источник —
 * @casino/shared-config), а не локальный список use-case. Раньше whitelist здесь
 * включал TON/TRX/LTC, исключённые из релиза, и заявка в такой валюте доходила
 * до провайдера. Отклонение — до первого запроса к NOWPayments.
 */
describe('CreateCryptoDepositUseCase: релизный набор валют (TZ-02)', () => {
  const RELEASE_CURRENCIES = ['USDT_TRC20', 'BTC']
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
  ]

  /** Мок клиента считает каждый вызов: «0 обращений» — часть утверждений. */
  function makeCountingDeps() {
    const estimatePrice = vi.fn(
      async (_params: { amount: string; currencyFrom: string; currencyTo: string }) => ({
        estimatedAmount: '9250.00',
      }),
    )
    const createPayment = vi.fn(
      async (_params: {
        priceAmount: string
        priceCurrency: string
        payCurrency: string
        orderId: string
        ipnCallbackUrl: string
      }) => NP_PAYMENT,
    )
    const repoCreate = vi.fn(async (_data: Record<string, unknown>) => ({ id: 'pr-1' }))
    const kycCalls: string[] = []

    const np = {
      getEstimatePrice: estimatePrice,
      createPayment,
    } as unknown as INowPaymentsClient
    const repo = { create: repoCreate } as unknown as IPaymentRequestRepository
    const kyc = {
      assertCanDeposit: async (_userId: string, amountRub: string) => {
        kycCalls.push(amountRub)
      },
    } as never

    const useCase = new CreateCryptoDepositUseCase(repo, np, kyc, { get: () => undefined } as never)
    return { useCase, estimatePrice, createPayment, repoCreate, kycCalls }
  }

  it.each(RELEASE_CURRENCIES)(
    'релизная валюта %s: оценка → KYC → платёж → заявка',
    async (currency) => {
      const deps = makeCountingDeps()

      const result = await deps.useCase.execute('u-1', '100', currency)

      expect(deps.estimatePrice).toHaveBeenCalledTimes(1)
      expect(deps.estimatePrice.mock.calls[0]?.[0]).toMatchObject({
        currencyFrom: currency,
        currencyTo: 'RUB',
      })
      expect(deps.createPayment).toHaveBeenCalledWith(
        expect.objectContaining({ payCurrency: currency }),
      )
      expect(deps.kycCalls).toEqual(['9250.00'])
      expect(deps.repoCreate).toHaveBeenCalledTimes(1)
      expect(result.payment_request_id).toBe('pr-1')
    },
  )

  it.each(NOT_RELEASE_CURRENCIES)(
    'валюта вне релиза %j → INVALID_CURRENCY/422, ноль обращений к провайдеру и в БД',
    async (currency) => {
      const deps = makeCountingDeps()

      const raised = await deps.useCase.execute('u-1', '100', currency).then(
        () => undefined,
        (error: unknown) => error as InvalidCurrencyError,
      )

      expect(raised).toBeInstanceOf(InvalidCurrencyError)
      expect(raised?.code).toBe('INVALID_CURRENCY')
      expect(raised?.httpStatus).toBe(422)
      expect(deps.estimatePrice).toHaveBeenCalledTimes(0)
      expect(deps.createPayment).toHaveBeenCalledTimes(0)
      expect(deps.repoCreate).toHaveBeenCalledTimes(0)
      expect(deps.kycCalls).toHaveLength(0)
    },
  )

  it('AppError из клиента не превращается в 502: INVALID_CURRENCY остаётся 422', async () => {
    const repoCreate = vi.fn()
    const np = {
      getEstimatePrice: async () => ({ estimatedAmount: '9250.00' }),
      createPayment: async () => {
        throw new InvalidCurrencyError('back-stop проверка клиента')
      },
    } as unknown as INowPaymentsClient
    const useCase = new CreateCryptoDepositUseCase(
      { create: repoCreate } as unknown as IPaymentRequestRepository,
      np,
      { assertCanDeposit: async () => undefined } as never,
      { get: () => undefined } as never,
    )

    const raised = await useCase.execute('u-1', '100', 'BTC').then(
      () => undefined,
      (error: unknown) => error as InvalidCurrencyError,
    )

    expect(raised).toBeInstanceOf(InvalidCurrencyError)
    expect(raised?.code).toBe('INVALID_CURRENCY')
    expect(raised?.httpStatus).toBe(422)
    expect(repoCreate).toHaveBeenCalledTimes(0)
  })

  it('идемпотентность не задета: ключ заявки генерируется до createPayment', async () => {
    const deps = makeCountingDeps()

    await deps.useCase.execute('u-1', '100', 'BTC')

    const row = deps.repoCreate.mock.calls[0]?.[0] as { idempotencyKey: string; externalId: string }
    expect(row.idempotencyKey).toMatch(/^dep_[0-9a-f-]{36}$/)
    expect(row.externalId).toBe(NP_PAYMENT.paymentId)
  })
})
