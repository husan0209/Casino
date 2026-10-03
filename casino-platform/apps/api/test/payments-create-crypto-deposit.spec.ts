/**
 * Юнит-тесты CreateCryptoDepositUseCase (G21).
 *
 * Пайплайн: whitelist валют → RUB-оценка через NOWPayments → KYC-лимит →
 * NP createPayment → заявка в БД (pay_address в metadata). Ошибка NP
 * оборачивается в PaymentProviderError, заявка до БД не доезжает.
 */
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

  const repo = {
    create: async (data: CreatedRow) => {
      created.push(data)
      return { id: 'pr-1' } as unknown as PaymentRequest
    },
  } as unknown as IPaymentRequestRepository

  const np: INowPaymentsClient = {
    getEstimatePrice: async () => ({ estimatedAmount: '12345.5' }),
    createPayment: async () => {
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
  return { uc, created, kycCalls }
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

    const uc = new CreateCryptoDepositUseCase(
      repo,
      np,
      kyc,
      { get: () => undefined } as never,
    )
    await expect(uc.execute('u-1', '100', 'BTC')).rejects.toThrow(KycRequiredError)
  })

  it('NOWPayments упал на createPayment → PaymentProviderError, заявка не создана', async () => {
    const d = makeDeps({ npError: new Error('np down') })
    await expect(d.uc.execute('u-1', '99.9', 'USDT_TRC20')).rejects.toThrow(PaymentProviderError)
    expect(d.created).toHaveLength(0)
  })
})
