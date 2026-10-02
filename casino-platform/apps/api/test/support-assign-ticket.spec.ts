/**
 * G21-спек AssignTicketUseCase (В3: назначение тикета больше не пишется из
 * `SupportAdminController`, порт `SUPPORT_REPOSITORY` в контроллере остался
 * только на чтение).
 *
 * Проверяем сохранённое поведение эндпоинта POST /admin/support/tickets/:id/assign:
 *  - admin_id задан → назначаем;
 *  - admin_id отсутствует → null (снять исполнителя) — ровно как делал
 *    прежний `dto.admin_id || null`;
 *  - ответ всегда { ok: true }, форма контракта не менялась;
 *  - отказ порта пробрасывается (без «мягкого» успеха).
 */
import { describe, expect, it, vi } from 'vitest'

import { AssignTicketUseCase } from '../src/modules/support/application/use-cases/assign-ticket.use-case'

import type { ISupportRepository } from '../src/modules/support/domain/repositories/support.repository'

function makeRepo(overrides: { assignError?: Error } = {}) {
  const assigned: Array<{ ticketId: string; adminId: string | null }> = []
  const assign = vi.fn(async (ticketId: string, adminId: string | null) => {
    assigned.push({ ticketId, adminId })
    if (overrides.assignError !== undefined) {
      throw overrides.assignError
    }
  })
  const repo = { assign } as unknown as ISupportRepository
  return { repo, assigned }
}

describe('AssignTicketUseCase', () => {
  it('назначает администратора на тикет', async () => {
    const { repo, assigned } = makeRepo()
    const result = await new AssignTicketUseCase(repo).execute({
      ticketId: 't-1',
      adminId: 'a-9',
    })

    expect(result).toEqual({ ok: true })
    expect(assigned).toEqual([{ ticketId: 't-1', adminId: 'a-9' }])
  })

  it('крайний случай: adminId = null — исполнитель снимается, а не остаётся', async () => {
    const { repo, assigned } = makeRepo()

    await new AssignTicketUseCase(repo).execute({ ticketId: 't-2', adminId: null })

    expect(assigned).toEqual([{ ticketId: 't-2', adminId: null }])
  })

  it('отказ порта пробрасывается: ok не возвращается', async () => {
    const { repo, assigned } = makeRepo({ assignError: new Error('db down') })

    await expect(
      new AssignTicketUseCase(repo).execute({ ticketId: 't-3', adminId: 'a-1' }),
    ).rejects.toThrow('db down')
    expect(assigned).toHaveLength(1)
  })
})
