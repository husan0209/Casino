/**
 * Админские чтения журнала (G27): запрос владельца `ledger_entries`.
 *
 * Главное, что проверяется, — фильтр по валюте. У самой проводки колонки
 * валюты нет: она принадлежит кошельку (`wallet_account`), и прямой
 * `where: { currency }` — это ошибка, которую Prisma не заметит только если в
 * схеме когда-нибудь появится одноимённое поле. Остальное — форма списка,
 * которая после переезда из контроллера обязана остаться прежней.
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
      ledgerEntry: {
        findMany: (args: unknown): Promise<unknown[]> => findMany(args),
        count: (args: unknown): Promise<number> => count(args),
      },
    },
  }
})

import { PrismaWalletRepository } from './wallet.ledger.prisma'

const repo = new PrismaWalletRepository()

function firstArg(mock: { mock: { calls: unknown[][] } }): Record<string, unknown> {
  return mock.mock.calls[0]![0] as Record<string, unknown>
}

beforeEach(() => {
  findMany.mockReset()
  count.mockReset()
  findMany.mockResolvedValue([])
  count.mockResolvedValue(0)
})

describe('PrismaWalletRepository.listEntries', () => {
  it('валюта фильтруется через кошелёк, а не по колонке проводки', async () => {
    await repo.listEntries({ currency: 'RUB', page: 1, perPage: 20 })

    expect(firstArg(findMany)['where']).toEqual({ walletAccount: { currency: 'RUB' } })
  })

  it('список отсортирован по времени и отдаёт валюту кошелька с email игрока', async () => {
    await repo.listEntries({ page: 3, perPage: 10 })

    const args = firstArg(findMany)
    expect(args['orderBy']).toEqual({ createdAt: 'desc' })
    expect(args['skip']).toBe(20)
    expect(args['take']).toBe(10)
    expect(args['include']).toEqual({
      walletAccount: { select: { currency: true } },
      user: { select: { email: true } },
    })
  })

  it('фильтры игрока и типа добавляются только когда переданы', async () => {
    await repo.listEntries({ userId: 'u-1', type: 'DEPOSIT', page: 1, perPage: 20 })

    expect(firstArg(findMany)['where']).toEqual({ userId: 'u-1', type: 'DEPOSIT' })

    findMany.mockClear()
    await repo.listEntries({ userId: undefined, page: 1, perPage: 20 })
    expect(firstArg(findMany)['where']).toEqual({})
  })

  it('total считается по тому же where, что и список', async () => {
    count.mockResolvedValue(7)

    const [items, total] = await repo.listEntries({ type: 'WITHDRAWAL', page: 1, perPage: 20 })

    expect(items).toEqual([])
    expect(total).toBe(7)
    expect(firstArg(count)['where']).toEqual({ type: 'WITHDRAWAL' })
  })
})

describe('PrismaWalletRepository.findEntriesForPayment', () => {
  it('связь с заявкой читается из metadata (jsonb), без пагинации', async () => {
    await repo.findEntriesForPayment('pr-9')

    const args = firstArg(findMany)
    expect(args['where']).toEqual({
      metadata: { path: ['payment_request_id'], equals: 'pr-9' },
    })
    // лимита нет намеренно: проводок у заявки несколько, и резать их произвольным
    // числом значило бы молча соврать в карточке
    expect(args['take']).toBeUndefined()
  })
})
