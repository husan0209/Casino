/**
 * Чтение журнала аудита (G27): форма запроса, ушедшая из контроллера.
 *
 * Проверяется то, что не видно по ответу: какие фильтры вообще попадают в
 * `where` и по какому where считается `count`. Ошибка здесь не роняет админку —
 * она показывает админу пустой список или, что хуже, список без фильтра.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CasinoDatabase from '@casino/database'

const findMany = vi.fn<(args: unknown) => Promise<unknown[]>>()
const count = vi.fn<(args: unknown) => Promise<number>>()

vi.mock('@casino/database', async (importOriginal) => {
  const actual = await importOriginal<typeof CasinoDatabase>()
  return {
    ...actual,
    prisma: {
      auditLog: {
        findMany: (args: unknown): Promise<unknown[]> => findMany(args),
        count: (args: unknown): Promise<number> => count(args),
      },
    },
  }
})

import { PrismaAuditLogRepository } from './admin.prisma.repository'

const repo = new PrismaAuditLogRepository()

function firstArg(mock: { mock: { calls: unknown[][] } }): Record<string, unknown> {
  return mock.mock.calls[0]![0] as Record<string, unknown>
}

beforeEach(() => {
  findMany.mockReset()
  count.mockReset()
  findMany.mockResolvedValue([])
  count.mockResolvedValue(0)
})

describe('PrismaAuditLogRepository.list', () => {
  it('без фильтров — пустой where, порядок по времени и пагинация', async () => {
    await repo.list({ page: 3, perPage: 50 })

    const args = firstArg(findMany)
    expect(args['where']).toEqual({})
    expect(args['skip']).toBe(100)
    expect(args['take']).toBe(50)
    expect(args['orderBy']).toEqual({ createdAt: 'desc' })
    expect(firstArg(count)['where']).toEqual({})
  })

  it('action ищется подстрокой, actor_type и target_type — точным значением', async () => {
    await repo.list({
      actorType: 'admin',
      actorId: 'adm-1',
      action: 'admin.withdrawal.',
      targetType: 'payment_request',
      page: 1,
      perPage: 20,
    })

    expect(firstArg(findMany)['where']).toEqual({
      actorType: 'admin',
      actorId: 'adm-1',
      action: { contains: 'admin.withdrawal.' },
      targetType: 'payment_request',
    })
  })

  it('undefined-фильтры не превращаются в ключи where', async () => {
    // `{ action: { contains: undefined } }` Prisma не считает ошибкой: список
    // стал бы пустым, и админ решил бы, что действия не совершались
    await repo.list({
      actorType: undefined,
      actorId: undefined,
      action: undefined,
      targetType: undefined,
      page: 1,
      perPage: 20,
    })

    expect(firstArg(findMany)['where']).toEqual({})
  })

  it('total считается по тому же where, что и список', async () => {
    count.mockResolvedValue(4)

    const [, total] = await repo.list({ actorType: 'user', page: 1, perPage: 20 })

    expect(total).toBe(4)
    expect(firstArg(count)['where']).toEqual(firstArg(findMany)['where'])
  })
})
