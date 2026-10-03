/**
 * G21-спек сценария одобрения заявки на вывод (В3: логика ушла из
 * `AdminFinanceController.approveOne` в application/use-cases).
 *
 * Покрывается то, за что раньше отвечал контроллер:
 *  1) проверка «только pending withdrawal» — источник кода 409;
 *  2) ПОРЯДОК шагов: сначала списание через кошелёк, только потом статус
 *     `completed` (обратный порядок оставлял бы заявку закрытой при отказе
 *     кошелька);
 *  3) отказ любого порта пробрасывается, вторая запись не делается;
 *  4) аудит пишется с HTTP-контекстом администратора.
 *
 * Имя `ApproveWithdrawalUseCase` в describe — маркер для храповика G21
 * (`tech-debt check use-case-specs` ищет имя класса, целое слово): когда
 * `admin.module.ts` освободится, тело переедет в @Injectable-класс с этим
 * именем и спектр менять не придётся.
 */
import { describe, expect, it, vi } from 'vitest'

import { approveWithdrawal } from '../src/modules/admin/application/use-cases/approve-withdrawal.use-case'
import { WithdrawalInvalidStatusError } from '../src/modules/admin/domain/errors'

import type { IWithdrawalRequestStore } from '../src/modules/admin/domain/withdrawal.repository'

const PENDING_WITHDRAWAL = {
  id: 'pr-1',
  userId: 'u-1',
  currency: 'RUB',
  amount: { toString: () => '1500.00' },
  type: 'withdrawal',
  status: 'pending',
}

function makeDeps(
  over: {
    row?: unknown
    confirmError?: Error
    updateError?: Error
  } = {},
) {
  const statusUpdates: Array<{ id: string; status: string; extra: unknown }> = []
  const auditCalls: Array<Record<string, unknown>> = []
  const confirmWithdrawal = vi.fn(async (_args: unknown) => {
    if (over.confirmError !== undefined) {
      throw over.confirmError
    }
    return { ok: true }
  })
  const payments = {
    findById: async () => (over.row === undefined ? PENDING_WITHDRAWAL : over.row),
    updateStatus: async (id: string, status: string, extra?: unknown) => {
      if (over.updateError !== undefined) {
        throw over.updateError
      }
      statusUpdates.push({ id, status, extra })
      return { id, status }
    },
  } as unknown as IWithdrawalRequestStore

  const deps = {
    payments,
    wallet: { confirmWithdrawal, unlock: vi.fn() } as never,
    audit: { log: async (input: Record<string, unknown>) => void auditCalls.push(input) } as never,
  }

  return { deps, statusUpdates, auditCalls, confirmWithdrawal }
}

const CONTEXT = { actorId: 'admin-1', ipAddress: '203.0.113.9', userAgent: 'jest' }

describe('ApproveWithdrawalUseCase', () => {
  it('happy path: списание → completed → аудит, ровно в этом порядке', async () => {
    const { deps, statusUpdates, auditCalls, confirmWithdrawal } = makeDeps()

    await approveWithdrawal(deps, { paymentRequestId: 'pr-1', context: CONTEXT })

    expect(confirmWithdrawal).toHaveBeenCalledTimes(1)
    expect(confirmWithdrawal.mock.calls[0]?.[0]).toMatchObject({
      userId: 'u-1',
      currency: 'RUB',
      amount: '1500.00',
      idempotencyKey: 'wd_confirm_pr-1',
      metadata: { payment_request_id: 'pr-1' },
    })
    expect(statusUpdates).toHaveLength(1)
    expect(statusUpdates[0]).toMatchObject({ id: 'pr-1', status: 'completed' })
    expect((statusUpdates[0]?.extra as { completedAt?: Date }).completedAt).toBeInstanceOf(Date)
    expect(auditCalls[0]).toMatchObject({
      actorType: 'admin',
      actorId: 'admin-1',
      action: 'admin.withdrawal.approved',
      targetId: 'pr-1',
      ipAddress: '203.0.113.9',
      userAgent: 'jest',
    })
  })

  it('отказ кошелька: статус НЕ меняется, ошибка идёт наверх', async () => {
    const { deps, statusUpdates } = makeDeps({ confirmError: new Error('wallet down') })

    await expect(
      approveWithdrawal(deps, { paymentRequestId: 'pr-1', context: CONTEXT }),
    ).rejects.toThrow('wallet down')
    expect(statusUpdates).toHaveLength(0)
  })

  it('заявка уже обработана (не pending) → WithdrawalInvalidStatusError, записей нет', async () => {
    const { deps, statusUpdates, auditCalls, confirmWithdrawal } = makeDeps({
      row: { ...PENDING_WITHDRAWAL, status: 'completed' },
    })

    await expect(
      approveWithdrawal(deps, { paymentRequestId: 'pr-1', context: CONTEXT }),
    ).rejects.toBeInstanceOf(WithdrawalInvalidStatusError)
    expect(confirmWithdrawal).not.toHaveBeenCalled()
    expect(statusUpdates).toHaveLength(0)
    expect(auditCalls).toHaveLength(0)
  })

  it('заявки нет вовсе — тот же 409, а не TypeError (port вернул null)', async () => {
    const { deps, statusUpdates } = makeDeps({ row: null })

    await expect(
      approveWithdrawal(deps, { paymentRequestId: 'missing', context: CONTEXT }),
    ).rejects.toBeInstanceOf(WithdrawalInvalidStatusError)
    expect(statusUpdates).toHaveLength(0)
  })

  it('не вывод (депозит) одобрить нельзя — проверка type, а не только status', async () => {
    const { deps, confirmWithdrawal } = makeDeps({
      row: { ...PENDING_WITHDRAWAL, type: 'deposit' },
    })

    await expect(
      approveWithdrawal(deps, { paymentRequestId: 'pr-1', context: CONTEXT }),
    ).rejects.toBeInstanceOf(WithdrawalInvalidStatusError)
    expect(confirmWithdrawal).not.toHaveBeenCalled()
  })

  it('отказ порта записи статуса пробрасывается после успешного списания', async () => {
    const { deps, auditCalls, confirmWithdrawal } = makeDeps({ updateError: new Error('db down') })

    await expect(
      approveWithdrawal(deps, { paymentRequestId: 'pr-1', context: CONTEXT }),
    ).rejects.toThrow('db down')
    expect(confirmWithdrawal).toHaveBeenCalledTimes(1)
    expect(auditCalls).toHaveLength(0)
  })
})
