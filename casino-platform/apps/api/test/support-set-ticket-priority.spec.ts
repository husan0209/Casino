/**
 * G21-спек SetTicketPriorityUseCase (В3: PATCH /admin/support/tickets/:id/priority
 * больше не пишет в БД из presentation-слоя).
 *
 * Инварианты:
 *  - допустимые приоритеты проходят в порт без изменений;
 *  - значение вне справочника — доменная ошибка InvalidTicketPriorityError (422,
 *    стабильный code), запись в порт НЕ делается. Через HTTP эту ветку
 *    отсекает SetPrioritySchema (400), поэтому контракт эндпоинта не меняется:
 *    проверка страхует вызовы не из контроллера;
 *  - отказ порта пробрасывается.
 */
import { describe, expect, it, vi } from 'vitest'

import { SetTicketPriorityUseCase } from '../src/modules/support/application/use-cases/set-ticket-priority.use-case'
import { InvalidTicketPriorityError } from '../src/modules/support/domain/errors'

import type {
  ISupportRepository,
  TicketPriority,
} from '../src/modules/support/domain/repositories/support.repository'

function makeRepo(overrides: { setError?: Error } = {}) {
  const written: Array<{ ticketId: string; priority: TicketPriority }> = []
  const setPriority = vi.fn(async (ticketId: string, priority: TicketPriority) => {
    written.push({ ticketId, priority })
    if (overrides.setError !== undefined) {
      throw overrides.setError
    }
  })
  return { repo: { setPriority } as unknown as ISupportRepository, written }
}

describe('SetTicketPriorityUseCase', () => {
  it.each(['low', 'normal', 'high', 'urgent'] as const)(
    'приоритет %s проходит в порт без изменений',
    async (priority) => {
      const { repo, written } = makeRepo()

      const result = await new SetTicketPriorityUseCase(repo).execute({
        ticketId: 't-1',
        priority,
      })

      expect(result).toEqual({ ok: true })
      expect(written).toEqual([{ ticketId: 't-1', priority }])
    },
  )

  it('значение вне справочника → InvalidTicketPriorityError, записи нет', async () => {
    const { repo, written } = makeRepo()

    await expect(
      new SetTicketPriorityUseCase(repo).execute({
        ticketId: 't-1',
        priority: 'blockbuster' as TicketPriority,
      }),
    ).rejects.toBeInstanceOf(InvalidTicketPriorityError)
    expect(written).toHaveLength(0)
  })

  it('отказ порта пробрасывается наверх', async () => {
    const { repo } = makeRepo({ setError: new Error('db down') })

    await expect(
      new SetTicketPriorityUseCase(repo).execute({ ticketId: 't-1', priority: 'urgent' }),
    ).rejects.toThrow('db down')
  })
})
