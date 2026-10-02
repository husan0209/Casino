/**
 * Юнит-тесты CreateFiatDepositUseCase (G21).
 *
 * Пайплайн: geo-валидация метода → лимиты (money.*, string) → KYC-лимит →
 * заявка в БД → Rukassa createPayment → updateStatus(pending). Падение
 * провайдера: заявка помечается failed, наружу PaymentProviderError.
 * Фасады geo/kyc/users подменены узкими объектами (`as unknown as`).
 */
import { CreateFiatDepositUseCase } from '../src/modules/payments/application/use-cases/create-fiat-deposit.use-case'
import {
  AmountTooLargeError,
  AmountTooSmallError,
  KycRequiredError,
  PaymentProviderError,
} from '../src/modules/payments/domain/errors'

import type {
  IPaymentRequestRepository,
  IRukassaClient,
  PaymentRequest,
} from '../src/modules/payments/domain/payments.ports'

const INPUT = { amount: '1000', currency: 'RUB', method: 'card' }

type CreatedRow = Record<string, unknown>
type StatusUpdate = { id: string; status: string; extra: Record<string, unknown> | undefined }

function makeDeps(over: { rukassaError?: Error } = {}) {
  const created: CreatedRow[] = []
  const statusUpdates: StatusUpdate[] = []
  const kycCalls: Array<{ userId: string; rub: string }> = []
  const geoCalls: Array<{ fn: string; args: unknown[] }> = []

  const repo = {
    create: async (data: CreatedRow) => {
      created.push(data)
      return { id: 'pr-1' } as unknown as PaymentRequest
    },
    updateStatus: async (id: string, status: string, extra?: Record<string, unknown>) => {
      statusUpdates.push({ id, status, extra })
      return { id } as unknown as PaymentRequest
    },
  } as unknown as IPaymentRequestRepository

  const rukassa: IRukassaClient = {
    createPayment: async () => {
      if (over.rukassaError) {
throw over.rukassaError
}
      return { paymentId: 'pay-1', paymentUrl: 'https://pay.url' }
    },
  } as unknown as IRukassaClient

  const kyc = {
    assertCanDeposit: async (userId: string, newDepositRub: string) => {
      kycCalls.push({ userId, rub: newDepositRub })
    },
  } as never

  const config = { get: () => undefined } as never

  const geo = {
    resolveLegalCountry: (country: string | null) => {
      geoCalls.push({ fn: 'resolveLegalCountry', args: [country] })
      return 'RU'
    },
    validateFiatDepositMethod: (...args: unknown[]) => {
      geoCalls.push({ fn: 'validateFiatDepositMethod', args })
    },
    getLimits: () => ({ depositMin: '500', depositMax: '100000' }),
    toRubEquivalent: (amount: string) => `rub(${amount})`,
  } as never

  const users = { getGeoContext: async () => ({ country: 'RU' }) } as never

  const uc = new CreateFiatDepositUseCase(repo, rukassa, kyc, config, geo, users)
  return { uc, created, statusUpdates, kycCalls, geoCalls }
}

describe('CreateFiatDepositUseCase', () => {
  it('happy path: заявка pending с лимит-проверкой, Rukassa вызван, статус дополнен ссылками', async () => {
    const d = makeDeps()
    const before = Date.now()
    const res = await d.uc.execute('u-1', INPUT)

    expect(d.geoCalls).toEqual([
      { fn: 'resolveLegalCountry', args: ['RU'] },
      { fn: 'validateFiatDepositMethod', args: ['RU', 'RUB', 'card'] },
    ])
    expect(d.kycCalls).toEqual([{ userId: 'u-1', rub: 'rub(1000)' }])

    const row = d.created[0]!
    expect(row.userId).toBe('u-1')
    expect(row.type).toBe('deposit')
    expect(row.status).toBe('pending')
    expect(row.provider).toBe('rukassa')
    expect(row.amount).toBe('1000')
    expect(row.idempotencyKey).toMatch(/^dep_/)
    const hours = ((row.expiresAt as Date).getTime() - before) / 3_600_000
    expect(hours).toBeGreaterThan(1.9)
    expect(hours).toBeLessThan(2.1)

    expect(d.statusUpdates).toEqual([
      {
        id: 'pr-1',
        status: 'pending',
        extra: { externalId: 'pay-1', paymentUrl: 'https://pay.url' },
      },
    ])
    expect(res).toEqual({
      payment_request_id: 'pr-1',
      payment_url: 'https://pay.url',
      currency: 'RUB',
      method: 'card',
    })
  })

  it('сумма ниже depositMin → AmountTooSmallError, заявка не создаётся', async () => {
    const d = makeDeps()
    await expect(d.uc.execute('u-1', { ...INPUT, amount: '499' })).rejects.toThrow(
      AmountTooSmallError,
    )
    expect(d.created).toHaveLength(0)
    expect(d.kycCalls).toHaveLength(0)
  })

  it('сумма выше depositMax → AmountTooLargeError', async () => {
    const d = makeDeps()
    await expect(d.uc.execute('u-1', { ...INPUT, amount: '100000.01' })).rejects.toThrow(
      AmountTooLargeError,
    )
    expect(d.created).toHaveLength(0)
  })

  it('KYC-лимит исчерпан → KycRequiredError пробрасывается до создания заявки', async () => {
    const repo = {
      create: async () => {
        throw new Error('must not be called')
      },
    } as unknown as IPaymentRequestRepository
    const kyc = {
      assertCanDeposit: async () => {
        throw new KycRequiredError()
      },
    } as never
    const geo = {
      resolveLegalCountry: () => 'RU',
      validateFiatDepositMethod: () => {},
      getLimits: () => ({ depositMin: '500', depositMax: '100000' }),
      toRubEquivalent: (amount: string) => amount,
    } as never
    const uc = new CreateFiatDepositUseCase(
      repo,
      {} as unknown as IRukassaClient,
      kyc,
      { get: () => undefined } as never,
      geo,
      { getGeoContext: async () => null } as never,
    )
    await expect(uc.execute('u-1', INPUT)).rejects.toThrow(KycRequiredError)
  })

  it('Rukassa упал → заявка failed с errorMessage, наружу PaymentProviderError', async () => {
    const d = makeDeps({ rukassaError: new Error('psp down') })
    await expect(d.uc.execute('u-1', INPUT)).rejects.toThrow(PaymentProviderError)
    expect(d.statusUpdates).toEqual([
      { id: 'pr-1', status: 'failed', extra: { errorMessage: 'psp down' } },
    ])
  })
})
