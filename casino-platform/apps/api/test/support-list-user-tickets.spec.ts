/**
 * Юнит-тесты ListUserTicketsUseCase (G21).
 *
 * Use-case — прокси в репозиторий; проверяем точную передачу аргументов,
 * включая условный status (ключ отсутствует, а не undefined).
 */
import { ListUserTicketsUseCase } from '../src/modules/support/application/use-cases/list-user-tickets.use-case'

import type {
  ISupportRepository,
  TicketListItem,
  TicketStatus,
} from '../src/modules/support/domain/repositories/support.repository'

function item(over: Partial<TicketListItem> = {}): TicketListItem {
  return {
    id: 't-1',
    subject: 'Не пришёл депозит',
    category: 'payments',
    status: 'open',
    priority: 'normal',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    _count: { messages: 2 },
    ...over,
  }
}

type ListArgs = { userId: string; status?: TicketStatus; page: number; perPage: number }

describe('ListUserTicketsUseCase', () => {
  it('аргументы проксируются как есть, результат репозитория возвращается без изменений', async () => {
    const got: ListArgs[] = []
    const repo = {
      listUserTickets: async (args: ListArgs) => {
        got.push(args)
        return { items: [item()], total: 1 }
      },
    } as unknown as ISupportRepository

    const res = await new ListUserTicketsUseCase(repo).execute({
      userId: 'u-1',
      status: 'open',
      page: 2,
      perPage: 10,
    })

    expect(got).toEqual([{ userId: 'u-1', status: 'open', page: 2, perPage: 10 }])
    expect(res).toEqual({ items: [item()], total: 1 })
  })

  it('status не задан → в репозиторий уходит объект БЕЗ ключа status', async () => {
    const got: Array<Record<string, unknown>> = []
    const repo = {
      listUserTickets: async (args: ListArgs) => {
        got.push(args as Record<string, unknown>)
        return { items: [], total: 0 }
      },
    } as unknown as ISupportRepository

    await new ListUserTicketsUseCase(repo).execute({ userId: 'u-1', page: 1, perPage: 20 })

    expect(Object.hasOwn(got[0]!, 'status')).toBe(false)
    expect(got[0]).toEqual({ userId: 'u-1', page: 1, perPage: 20 })
  })

  it('отказ порта (listUserTickets бросил) — ошибка пробрасывается', async () => {
    const repo = {
      listUserTickets: async () => {
        throw new Error('db down')
      },
    } as unknown as ISupportRepository

    await expect(
      new ListUserTicketsUseCase(repo).execute({ userId: 'u-1', page: 1, perPage: 20 }),
    ).rejects.toThrow('db down')
  })
})
