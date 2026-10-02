/**
 * Юнит-тесты GetTicketUseCase (G21).
 *
 * Разделение доступа: игрок читает только свой тикет (getTicketForUser +
 * защитная проверка userId), админ — любой (getAdmin, внутренние сообщения
 * включены).
 */
import { GetTicketUseCase } from '../src/modules/support/application/use-cases/get-ticket.use-case'
import { ForbiddenTicketError, TicketNotFoundError } from '../src/modules/support/domain/errors'

import type {
  ISupportRepository,
  MessageRow,
  TicketRow,
} from '../src/modules/support/domain/repositories/support.repository'

function ticket(over: Partial<TicketRow> = {}): TicketRow {
  return {
    id: 't-1',
    userId: 'u-1',
    subject: 'Не пришёл депозит',
    category: 'payments',
    status: 'in_progress',
    priority: 'normal',
    assignedTo: null,
    closedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...over,
  }
}

function message(over: Partial<MessageRow> = {}): MessageRow {
  return {
    id: 'm-1',
    ticketId: 't-1',
    senderType: 'user',
    senderId: 'u-1',
    message: 'Привет, где депозит?',
    isInternal: false,
    attachments: [],
    createdAt: new Date('2026-01-01T01:00:00.000Z'),
    ...over,
  }
}

describe('GetTicketUseCase', () => {
  it('игрок читает свой тикет: getTicketForUser, внутренние сообщения скрыты', async () => {
    const own = ticket()
    const listed: Array<{ ticketId: string; includeInternal: boolean }> = []
    const repo = {
      getTicketForUser: async () => own,
      listMessages: async (ticketId: string, includeInternal: boolean) => {
        listed.push({ ticketId, includeInternal })
        return [message()]
      },
    } as unknown as ISupportRepository

    const res = await new GetTicketUseCase(repo).execute('u-1', 't-1')

    expect(listed).toEqual([{ ticketId: 't-1', includeInternal: false }])
    expect(res.id).toBe('t-1')
    expect(res.userId).toBe('u-1')
    expect(res.messages).toHaveLength(1)
    expect(res.messages[0]!.message).toBe('Привет, где депозит?')
  })

  it('тикет не найден → TicketNotFoundError', async () => {
    const repo = { getTicketForUser: async () => null } as unknown as ISupportRepository
    await expect(new GetTicketUseCase(repo).execute('u-1', 'nope')).rejects.toThrow(
      TicketNotFoundError,
    )
  })

  it('репозиторий отдал чужой тикет → ForbiddenTicketError (защита на слое use-case)', async () => {
    const repo = {
      getTicketForUser: async () => ticket({ userId: 'u-other' }),
    } as unknown as ISupportRepository
    await expect(new GetTicketUseCase(repo).execute('u-1', 't-1')).rejects.toThrow(
      ForbiddenTicketError,
    )
  })

  it('админ читает через getAdmin, внутренние сообщения включены, чужой юзер не мешает', async () => {
    const listed: Array<{ ticketId: string; includeInternal: boolean }> = []
    const repo = {
      getAdmin: async () => ticket({ userId: 'u-other' }),
      listMessages: async (ticketId: string, includeInternal: boolean) => {
        listed.push({ ticketId, includeInternal })
        return [message(), message({ isInternal: true, senderType: 'admin', senderId: 'a-1' })]
      },
    } as unknown as ISupportRepository

    const res = await new GetTicketUseCase(repo).execute('u-1', 't-1', true)

    expect(listed).toEqual([{ ticketId: 't-1', includeInternal: true }])
    expect(res.messages).toHaveLength(2)
  })

  it('у админа тикет не найден → TicketNotFoundError', async () => {
    const repo = { getAdmin: async () => null } as unknown as ISupportRepository
    await expect(new GetTicketUseCase(repo).execute('a-1', 'nope', true)).rejects.toThrow(
      TicketNotFoundError,
    )
  })
})
