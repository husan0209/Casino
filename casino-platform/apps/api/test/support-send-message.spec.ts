/**
 * Юнит-тесты SendMessageUseCase (G21).
 *
 * Правила: в закрытый тикет писать нельзя; юзер пишет только в свой тикет;
 * статус тикета двигается навстречу отправителю (админ → waiting_user,
 * юзер из waiting_user → in_progress), внутренняя заметка админа статус
 * не двигает.
 */
import { SendMessageUseCase } from '../src/modules/support/application/use-cases/send-message.use-case'
import {
  ForbiddenTicketError,
  TicketClosedError,
  TicketNotFoundError,
} from '../src/modules/support/domain/errors'

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
    status: 'in_progress',
    priority: 'normal',
    assignedTo: null,
    closedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...over,
  }
}

type AddMessageArgs = {
  ticketId: string
  senderType: 'user' | 'admin'
  senderId: string
  message: string
  isInternal: boolean
  attachments: unknown[]
}

function makeRepo(over: { t?: TicketRow | null } = {}) {
  const added: AddMessageArgs[] = []
  const statusChanges: Array<{ ticketId: string; status: TicketRow['status'] }> = []
  const repo = {
    getAdmin: async () => over.t ?? null,
    addMessage: async (args: AddMessageArgs) => {
      added.push(args)
      return { id: 'm-1' }
    },
    setStatus: async (ticketId: string, status: TicketRow['status']) => {
      statusChanges.push({ ticketId, status })
    },
  } as unknown as ISupportRepository
  return { repo, added, statusChanges }
}

describe('SendMessageUseCase', () => {
  it('юзер пишет в свой тикет waiting_user → сообщение добавлено, статус → in_progress', async () => {
    const { repo, added, statusChanges } = makeRepo({ t: ticket({ status: 'waiting_user' }) })
    const res = await new SendMessageUseCase(repo).execute({
      ticketId: 't-1',
      senderType: 'user',
      senderId: 'u-1',
      message: 'Всё ещё жду',
      ownerCheckUserId: 'u-1',
    })

    expect(res).toEqual({ id: 'm-1' })
    expect(added).toEqual([
      {
        ticketId: 't-1',
        senderType: 'user',
        senderId: 'u-1',
        message: 'Всё ещё жду',
        isInternal: false,
        attachments: [],
      },
    ])
    expect(statusChanges).toEqual([{ ticketId: 't-1', status: 'in_progress' }])
  })

  it('юзер пишет в тикет in_progress → статус не двигается', async () => {
    const { repo, statusChanges } = makeRepo({ t: ticket({ status: 'in_progress' }) })
    await new SendMessageUseCase(repo).execute({
      ticketId: 't-1',
      senderType: 'user',
      senderId: 'u-1',
      message: 'ok',
      ownerCheckUserId: 'u-1',
    })
    expect(statusChanges).toHaveLength(0)
  })

  it('админ пишет публичный ответ → статус → waiting_user', async () => {
    const { repo, statusChanges } = makeRepo({ t: ticket({ status: 'in_progress' }) })
    await new SendMessageUseCase(repo).execute({
      ticketId: 't-1',
      senderType: 'admin',
      senderId: 'a-1',
      message: 'Проверяем',
    })
    expect(statusChanges).toEqual([{ ticketId: 't-1', status: 'waiting_user' }])
  })

  it('внутренняя заметка админа: isInternal=true, статус не трогается', async () => {
    const { repo, added, statusChanges } = makeRepo({ t: ticket({ status: 'in_progress' }) })
    await new SendMessageUseCase(repo).execute({
      ticketId: 't-1',
      senderType: 'admin',
      senderId: 'a-1',
      message: 'Похоже на скам',
      isInternal: true,
    })
    expect(added[0]!.isInternal).toBe(true)
    expect(statusChanges).toHaveLength(0)
  })

  it('тикет не найден → TicketNotFoundError, сообщений нет', async () => {
    const { repo, added } = makeRepo({ t: null })
    await expect(
      new SendMessageUseCase(repo).execute({
        ticketId: 'nope',
        senderType: 'user',
        senderId: 'u-1',
        message: 'x',
        ownerCheckUserId: 'u-1',
      }),
    ).rejects.toThrow(TicketNotFoundError)
    expect(added).toHaveLength(0)
  })

  it('закрытый тикет → TicketClosedError', async () => {
    const { repo, added } = makeRepo({ t: ticket({ status: 'closed' }) })
    await expect(
      new SendMessageUseCase(repo).execute({
        ticketId: 't-1',
        senderType: 'user',
        senderId: 'u-1',
        message: 'x',
        ownerCheckUserId: 'u-1',
      }),
    ).rejects.toThrow(TicketClosedError)
    expect(added).toHaveLength(0)
  })

  it('юзер пишет в чужой тикет → ForbiddenTicketError (ownerCheck)', async () => {
    const { repo, added } = makeRepo({ t: ticket({ userId: 'u-other' }) })
    await expect(
      new SendMessageUseCase(repo).execute({
        ticketId: 't-1',
        senderType: 'user',
        senderId: 'u-1',
        message: 'x',
        ownerCheckUserId: 'u-1',
      }),
    ).rejects.toThrow(ForbiddenTicketError)
    expect(added).toHaveLength(0)
  })

  it('админ пишет в чужой тикет свободно (ownerCheck только для юзеров)', async () => {
    const { repo, added } = makeRepo({ t: ticket({ userId: 'u-other' }) })
    const res = await new SendMessageUseCase(repo).execute({
      ticketId: 't-1',
      senderType: 'admin',
      senderId: 'a-1',
      message: 'Ответ поддержки',
    })
    expect(res).toEqual({ id: 'm-1' })
    expect(added).toHaveLength(1)
  })
})
