/**
 * Юнит-тесты CancelWithdrawalUseCase (G21).
 *
 * Отменять можно только СВОЮ заявку в статусе pending: средства
 * разблокируются через wallet.unlock с детерминированным ключом
 * wd_unlock_<id> (дедуп повторных отмен в ledger), затем статус cancelled.
 */
import { CancelWithdrawalUseCase } from '../src/modules/payments/application/use-cases/cancel-withdrawal.use-case'
import { WithdrawalCancelForbiddenError } from '../src/modules/payments/domain/errors'

import type { IPaymentRequestRepository, PaymentRequest } from '../src/modules/payments/domain/payments.ports'

function pr(over: Partial<PaymentRequest> = {}): PaymentRequest {
  return {
    id: 'pr-9',
    userId: 'u-1',
    type: 'withdrawal',
    status: 'pending',
    provider: 'manual',
    currency: 'RUB',
    amount: '500' as never,
    fee: '0' as never,
    idempotencyKey: 'wd_x',
    metadata: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  } as unknown as PaymentRequest
}

type UnlockArgs = { userId: string; currency: string; amount: string; idempotencyKey: string; metadata: Record<string, string> }

function makeDeps(over: { row?: PaymentRequest | null } = {}) {
  const unlocked: UnlockArgs[] = []
  const statusUpdates: Array<{ id: string; status: string }> = []
  const repo = {
    findById: async () => over.row ?? null,
    updateStatus: async (id: string, status: string) => {
      statusUpdates.push({ id, status })
      return {} as unknown as PaymentRequest
    },
  } as unknown as IPaymentRequestRepository
  const wallet = {
    unlock: async (args: UnlockArgs) => {
      unlocked.push(args)
      return { ok: true }
    },
  } as never
  const uc = new CancelWithdrawalUseCase(repo, wallet)
  return { uc, unlocked, statusUpdates }
}

describe('CancelWithdrawalUseCase', () => {
  it('своя pending-заявка: unlock с ключом wd_unlock_<id>, статус cancelled', async () => {
    const d = makeDeps({ row: pr() })
    const res = await d.uc.execute('u-1', 'pr-9')

    expect(res).toEqual({ ok: true })
    expect(d.unlocked).toEqual([
      {
        userId: 'u-1',
        currency: 'RUB',
        amount: '500',
        idempotencyKey: 'wd_unlock_pr-9',
        metadata: { payment_request_id: 'pr-9' },
      },
    ])
    expect(d.statusUpdates).toEqual([{ id: 'pr-9', status: 'cancelled' }])
  })

  it('чужая заявка → WithdrawalCancelForbiddenError, средства не разблокируются', async () => {
    const d = makeDeps({ row: pr({ userId: 'u-other' }) })
    await expect(d.uc.execute('u-1', 'pr-9')).rejects.toThrow(WithdrawalCancelForbiddenError)
    expect(d.unlocked).toHaveLength(0)
    expect(d.statusUpdates).toHaveLength(0)
  })

  it('заявка не pending (уже completed) → WithdrawalCancelForbiddenError', async () => {
    const d = makeDeps({ row: pr({ status: 'completed' }) })
    await expect(d.uc.execute('u-1', 'pr-9')).rejects.toThrow('Cannot cancel')
    expect(d.unlocked).toHaveLength(0)
  })

  it('заявки нет → WithdrawalCancelForbiddenError (анти-энумерация)', async () => {
    const d = makeDeps({ row: null })
    await expect(d.uc.execute('u-1', 'nope')).rejects.toThrow(WithdrawalCancelForbiddenError)
  })

  it('wallet.unlock упал → статус не меняется, ошибка пробрасывается', async () => {
    const statusUpdates: Array<{ id: string; status: string }> = []
    const repo = {
      findById: async () => pr(),
      updateStatus: async (id: string, status: string) => {
        statusUpdates.push({ id, status })
        return {} as unknown as PaymentRequest
      },
    } as unknown as IPaymentRequestRepository
    const wallet = {
      unlock: async () => {
        throw new Error('ledger down')
      },
    } as never

    await expect(new CancelWithdrawalUseCase(repo, wallet).execute('u-1', 'pr-9')).rejects.toThrow(
      'ledger down',
    )
    expect(statusUpdates).toHaveLength(0)
  })
})
