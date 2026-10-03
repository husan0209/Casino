/**
 * Юнит-тесты GetDepositStatusUseCase (G21).
 *
 * Владелец видит статус своей заявки; чужая/несуществующая заявка отвечают
 * одинаковым PaymentRequestNotFoundError (анти-энумерация).
 */
import { GetDepositStatusUseCase } from '../src/modules/payments/application/use-cases/get-deposit-status.use-case'
import { PaymentRequestNotFoundError } from '../src/modules/payments/domain/errors'

import type { IPaymentRequestRepository, PaymentRequest } from '../src/modules/payments/domain/payments.ports'

function pr(over: Partial<PaymentRequest> = {}): PaymentRequest {
  return {
    id: 'pr-1',
    userId: 'u-1',
    type: 'deposit',
    status: 'completed',
    provider: 'rukassa',
    method: 'card',
    currency: 'RUB',
    amount: '1000.50' as never,
    fee: '0' as never,
    idempotencyKey: 'dep_x',
    metadata: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...over,
  } as unknown as PaymentRequest
}

describe('GetDepositStatusUseCase', () => {
  it('своя заявка: статус, сумма строкой, payment_url и completed_at отдаются', async () => {
    const repo = {
      findById: async () =>
        pr({ status: 'completed', paymentUrl: 'https://pay.url', completedAt: new Date('2026-01-02T12:00:00.000Z') }),
    } as unknown as IPaymentRequestRepository

    const res = await new GetDepositStatusUseCase(repo).execute('u-1', 'pr-1')

    expect(res).toEqual({
      id: 'pr-1',
      status: 'completed',
      currency: 'RUB',
      amount: '1000.50',
      payment_url: 'https://pay.url',
      completed_at: new Date('2026-01-02T12:00:00.000Z'),
    })
  })

  it('заявка без payment_url (крипто до оплаты) → payment_url null', async () => {
    const repo = {
      findById: async () => pr({ status: 'pending', paymentUrl: null }),
    } as unknown as IPaymentRequestRepository
    const res = await new GetDepositStatusUseCase(repo).execute('u-1', 'pr-1')
    expect(res.payment_url).toBeNull()
  })

  it('чужая заявка → PaymentRequestNotFoundError (как несуществующая)', async () => {
    const repo = {
      findById: async () => pr({ userId: 'u-other' }),
    } as unknown as IPaymentRequestRepository
    await expect(new GetDepositStatusUseCase(repo).execute('u-1', 'pr-1')).rejects.toThrow(
      PaymentRequestNotFoundError,
    )
  })

  it('заявки нет → PaymentRequestNotFoundError', async () => {
    const repo = {
      findById: async () => null,
    } as unknown as IPaymentRequestRepository
    await expect(new GetDepositStatusUseCase(repo).execute('u-1', 'nope')).rejects.toThrow(
      PaymentRequestNotFoundError,
    )
  })
})
