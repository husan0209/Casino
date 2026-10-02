/**
 * Юнит-тесты CloseTicketUseCase (G21).
 *
 * Правила: тикет должен существовать; юзер закрывает только свой тикет
 * (защита по userId), админ — любой.
 */
import { CloseTicketUseCase } from '../src/modules/support/application/use-cases/close-ticket.use-case'
import { ForbiddenTicketError, TicketNotFoundError } from '../src/modules/support/domain/errors'

import type {
  ISupportRepository,
  TicketRow,
} from '../src/modules/support/domain/repositories/support.repository'

function ticket(over: Partial<TicketRow> = {}): TicketRow {
  return {
    id: 't-1',
    userId: 'u-1',
    subject: 'Не пришёл депозит',
    category: 'payments',
    status: 'open',
    priority: 'normal',
    assignedTo: null,
    closedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...over,
  }
}

function makeRepo(over: { t?: TicketRow | null } = {}) {
  const closed: Array<{ ticketId: string; closedBy: 'user' | 'admin' }> = []
  const repo = {
    getAdmin: async () => over.t ?? null,
    closeTicket: async (ticketId: string, closedBy: 'user' | 'admin') => {
      closed.push({ ticketId, closedBy })
    },
  } as unknown as ISupportRepository
  return { repo, closed }
}

describe('CloseTicketUseCase', () => {
  it('юзер закрывает свой тикет: closeTicket(t-1, user), ok', async () => {
    const { repo, closed } = makeRepo({ t: ticket() })
    const res = await new CloseTicketUseCase(repo).execute('t-1', 'user', 'u-1')
    expect(res).toEqual({ ok: true })
    expect(closed).toEqual([{ ticketId: 't-1', closedBy: 'user' }])
  })

  it('админ закрывает чужой тикет: userId не проверяется', async () => {
    const { repo, closed } = makeRepo({ t: ticket({ userId: 'u-other' }) })
    const res = await new CloseTicketUseCase(repo).execute('t-1', 'admin', 'a-1')
    expect(res).toEqual({ ok: true })
    expect(closed).toEqual([{ ticketId: 't-1', closedBy: 'admin' }])
  })

  it('юзер закрывает чужой тикет → ForbiddenTicketError, закрытия нет', async () => {
    const { repo, closed } = makeRepo({ t: ticket({ userId: 'u-other' }) })
    await expect(new CloseTicketUseCase(repo).execute('t-1', 'user', 'u-1')).rejects.toThrow(
      ForbiddenTicketError,
    )
    expect(closed).toHaveLength(0)
  })

  it('тикет не найден → TicketNotFoundError', async () => {
    const { repo, closed } = makeRepo({ t: null })
    await expect(new CloseTicketUseCase(repo).execute('nope', 'user', 'u-1')).rejects.toThrow(
      TicketNotFoundError,
    )
    expect(closed).toHaveLength(0)
  })

  it('отказ порта (closeTicket бросил) — ошибка пробрасывается', async () => {
    const repo = {
      getAdmin: async () => ticket(),
      closeTicket: async () => {
        throw new Error('db down')
      },
    } as unknown as ISupportRepository
    await expect(new CloseTicketUseCase(repo).execute('t-1', 'admin')).rejects.toThrow('db down')
  })
})
