/**
 * G21-спек сценария отклонения заявки на вывод (В3: логика ушла из
 * `AdminFinanceController.rejectOne` в application/use-cases).
 *
 * Ключевые инварианты:
 *  1) отклонять можно только pending withdrawal (409 WithdrawalInvalidStatusError);
 *  2) разблокировка средств выполняется ДО перевода заявки в `cancelled`;
 *  3) причина отклонения попадает и в `payment_request.error_message`, и в
 *     payload аудита — регуляторный след;
 *  4) idempotency-ключ разблокировки уникален на вызов (randomUUID), поэтому
 *     повторное отклонение не «слипается» с первым на стороне кошелька.
 *
 * Имя `RejectWithdrawalUseCase` — маркер храповика G21 (см. аналог в
 * `admin-approve-withdrawal.spec.ts`).
 */
import { describe, expect, it, vi } from 'vitest'

import { rejectWithdrawal } from '../src/modules/admin/application/use-cases/reject-withdrawal.use-case'
import { WithdrawalInvalidStatusError } from '../src/modules/admin/domain/errors'

import type { IWithdrawalRequestStore } from '../src/modules/admin/domain/withdrawal.repository'

const PENDING_WITHDRAWAL = {
  id: 'pr-2',
  userId: 'u-2',
  currency: 'USDT_TRC20',
  amount: { toString: () => '84.50000000' },
  type: 'withdrawal',
  status: 'pending',
}

function makeDeps(over: { row?: unknown; unlockError?: Error } = {}) {
  const unlocks: Array<Record<string, unknown>> = []
  const statusUpdates: Array<{ id: string; status: string; extra: unknown }> = []
  const auditCalls: Array<Record<string, unknown>> = []
  const unlock = vi.fn(async (args: Record<string, unknown>) => {
    unlocks.push(args)
    if (over.unlockError !== undefined) {
      throw over.unlockError
    }
    return { ok: true }
  })
  const payments = {
    findById: async () => (over.row === undefined ? PENDING_WITHDRAWAL : over.row),
    updateStatus: async (id: string, status: string, extra?: unknown) => {
      statusUpdates.push({ id, status, extra })
      return { id, status }
    },
  } as unknown as IWithdrawalRequestStore

  const deps = {
    payments,
    wallet: { unlock, confirmWithdrawal: vi.fn() } as never,
    audit: { log: async (input: Record<string, unknown>) => void auditCalls.push(input) } as never,
  }

  return { deps, unlocks, statusUpdates, auditCalls }
}

const CONTEXT = { actorId: 'admin-2', ipAddress: '198.51.100.7' }

describe('RejectWithdrawalUseCase', () => {
  it('happy path: unlock → cancelled с причиной → аудит с причиной', async () => {
    const { deps, unlocks, statusUpdates, auditCalls } = makeDeps()

    await rejectWithdrawal(deps, {
      paymentRequestId: 'pr-2',
      reason: 'не прошёл проверку платёжного шлюза',
      context: CONTEXT,
    })

    expect(unlocks).toHaveLength(1)
    expect(unlocks[0]).toMatchObject({
      userId: 'u-2',
      currency: 'USDT_TRC20',
      amount: '84.50000000',
    })
    expect(String(unlocks[0]?.['idempotencyKey'])).toMatch(/^wd_unlock_pr-2_/)
    expect(statusUpdates).toEqual([
      {
        id: 'pr-2',
        status: 'cancelled',
        extra: { errorMessage: 'не прошёл проверку платёжного шлюза' },
      },
    ])
    expect(auditCalls[0]).toMatchObject({
      action: 'admin.withdrawal.rejected',
      actorId: 'admin-2',
      targetId: 'pr-2',
      payload: { reason: 'не прошёл проверку платёжного шлюза' },
      ipAddress: '198.51.100.7',
    })
  })

  it('отказ кошелька: заявка остаётся pending, статус не пишется', async () => {
    const { deps, statusUpdates, auditCalls } = makeDeps({ unlockError: new Error('wallet down') })

    await expect(
      rejectWithdrawal(deps, { paymentRequestId: 'pr-2', reason: 'x', context: CONTEXT }),
    ).rejects.toThrow('wallet down')
    expect(statusUpdates).toHaveLength(0)
    expect(auditCalls).toHaveLength(0)
  })

  it('заявка не pending → 409 и ни одной записи', async () => {
    const { deps, unlocks, statusUpdates } = makeDeps({
      row: { ...PENDING_WITHDRAWAL, status: 'cancelled' },
    })

    await expect(
      rejectWithdrawal(deps, { paymentRequestId: 'pr-2', reason: 'x', context: CONTEXT }),
    ).rejects.toBeInstanceOf(WithdrawalInvalidStatusError)
    expect(unlocks).toHaveLength(0)
    expect(statusUpdates).toHaveLength(0)
  })

  it('крайний случай: причина не передана — error_message уходит undefined, аудит всё равно есть', async () => {
    const { deps, statusUpdates, auditCalls } = makeDeps()

    await rejectWithdrawal(deps, { paymentRequestId: 'pr-2', context: CONTEXT })

    expect(statusUpdates[0]?.extra).toEqual({ errorMessage: undefined })
    expect(auditCalls[0]?.['payload']).toEqual({ reason: undefined })
  })

  it('idempotency-ключ уникален между вызовами (без randomUUID повтор слипся бы на кошельке)', async () => {
    const { deps, unlocks } = makeDeps()

    await rejectWithdrawal(deps, { paymentRequestId: 'pr-2', reason: 'x', context: CONTEXT })
    await rejectWithdrawal(deps, { paymentRequestId: 'pr-2', reason: 'x', context: CONTEXT })

    const keys = unlocks.map((call) => String(call['idempotencyKey']))
    expect(new Set(keys).size).toBe(2)
  })
})
