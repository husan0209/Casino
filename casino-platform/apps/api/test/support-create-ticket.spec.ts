/**
 * Юнит-тесты CreateTicketUseCase (G21).
 *
 * Единственное правило бизнес-логики: лимит 5 открытых тикетов на игрока.
 * Репозиторий замокан узко (только используемые методы, `as unknown as`).
 */
import { CreateTicketUseCase } from '../src/modules/support/application/use-cases/create-ticket.use-case'
import { TooManyOpenTicketsError } from '../src/modules/support/domain/errors'

import type {
  ISupportRepository,
  TicketCategory,
} from '../src/modules/support/domain/repositories/support.repository'

const INPUT = { subject: 'Не пришёл депозит', category: 'payments' as TicketCategory, message: 'Жду 2 часа' }

type CreatedTicket = { userId: string; subject: string; category: TicketCategory; message: string }

describe('CreateTicketUseCase', () => {
  it('лимит не исчерпан: тикет создан с полями игрока, id возвращён', async () => {
    const created: CreatedTicket[] = []
    const repo = {
      countOpenByUser: async () => 4,
      createTicket: async (args: CreatedTicket) => {
        created.push(args)
        return { id: 't-1' }
      },
    } as unknown as ISupportRepository

    const res = await new CreateTicketUseCase(repo).execute('u-1', INPUT)

    expect(res).toEqual({ id: 't-1' })
    expect(created).toEqual([{ userId: 'u-1', ...INPUT }])
  })

  it('5 открытых тикетов → TooManyOpenTicketsError, создания нет', async () => {
    const repo = {
      countOpenByUser: async () => 5,
      createTicket: async () => {
        throw new Error('create must not be called at the limit')
      },
    } as unknown as ISupportRepository

    await expect(new CreateTicketUseCase(repo).execute('u-1', INPUT)).rejects.toThrow(
      TooManyOpenTicketsError,
    )
  })

  it('отказ порта (createTicket бросил) — ошибка пробрасывается', async () => {
    const repo = {
      countOpenByUser: async () => 0,
      createTicket: async () => {
        throw new Error('db down')
      },
    } as unknown as ISupportRepository

    await expect(new CreateTicketUseCase(repo).execute('u-1', INPUT)).rejects.toThrow('db down')
  })
})
