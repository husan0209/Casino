import { ForbiddenException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CreateWithdrawalUseCase } from '../src/modules/payments/application/use-cases/create-withdrawal.use-case'

/**
 * GAP-55 (§11 «статус»): заявка на вывод и её проводки должны быть связаны.
 *
 * Это деньги, поэтому проверяем три свойства порядка:
 *  1) lock получает idempotencyKey и metadata со ССЫЛКОЙ на ещё не созданную
 *     заявку (id генерируется до блокировки), и та же id идёт в create —
 *     иначе строка истории не присоединима к заявке;
 *  2) при отказе блокировки заявка НЕ создаётся (не появляется pending-заявка
 *     без замороженных средств);
 *  3) KYC-гейт стоит ПЕРЕД любой мутацией баланса.
 *
 * Prisma не поднимается (нет БД в этой среде) — фасады мокнуты, как в
 * change-password.spec.ts.
 */
interface Harness {
  useCase: CreateWithdrawalUseCase
  lock: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
  assertCanWithdraw: ReturnType<typeof vi.fn>
}

function harness(): Harness {
  const lock = vi.fn().mockResolvedValue({ duplicate: false })
  const create = vi.fn().mockImplementation((data: { id: string }) => Promise.resolve({ id: data.id }))
  const assertCanWithdraw = vi.fn().mockResolvedValue(undefined)
  const repo = { create } as never
  const wallet = { lock } as never
  const kyc = { assertCanWithdraw } as never
  return {
    useCase: new CreateWithdrawalUseCase(repo, wallet, kyc),
    lock,
    create,
    assertCanWithdraw,
  }
}

const input = { amount: '1000', currency: 'RUB', method: 'card', destination: '2200700012345678' }

describe('GAP-55 create-withdrawal: связь заявки и проводки', () => {
  let h: Harness

  beforeEach(() => {
    h = harness()
  })

  it('lock и create получают ОДИН И ТОТ ЖЕ id заявки, в metadata — ссылка', async () => {
    const result = await h.useCase.execute('u1', input)

    const lockArgs = h.lock.mock.calls[0]?.[0] as {
      idempotencyKey: string
      metadata: { payment_request_id: string }
    }
    const createArgs = h.create.mock.calls[0]?.[0] as { id: string; idempotencyKey: string }
    expect(lockArgs.metadata.payment_request_id).toBe(createArgs.id)
    expect(lockArgs.idempotencyKey).toBe(`wd_lock_${createArgs.id}`)
    expect(createArgs.idempotencyKey).toBe(`wd_${createArgs.id}`)
    expect(result.payment_request_id).toBe(createArgs.id)
  })

  it('два вызова дают разные id (уникальность заявок сохранена)', async () => {
    const first = await h.useCase.execute('u1', input)
    const second = await h.useCase.execute('u1', input)
    expect(first.payment_request_id).not.toBe(second.payment_request_id)
  })

  it('при отказе блокировки заявка не создаётся', async () => {
    h.lock.mockRejectedValueOnce(new Error('INSUFFICIENT_FUNDS'))
    await expect(h.useCase.execute('u1', input)).rejects.toThrow('INSUFFICIENT_FUNDS')
    expect(h.create).not.toHaveBeenCalled()
  })

  it('KYC-гейт до мутации баланса', async () => {
    h.assertCanWithdraw.mockRejectedValueOnce(new ForbiddenException('KYC_REQUIRED'))
    await expect(h.useCase.execute('u1', input)).rejects.toThrow(ForbiddenException)
    expect(h.lock).not.toHaveBeenCalled()
    expect(h.create).not.toHaveBeenCalled()
  })

  it('amount — строка, money-контракт не тонет в number', async () => {
    await h.useCase.execute('u1', { ...input, amount: '1200.50' })
    const lockArgs = h.lock.mock.calls[0]?.[0] as { amount: unknown }
    const createArgs = h.create.mock.calls[0]?.[0] as { amount: unknown }
    expect(typeof lockArgs.amount).toBe('string')
    expect(typeof createArgs.amount).toBe('string')
  })
})
