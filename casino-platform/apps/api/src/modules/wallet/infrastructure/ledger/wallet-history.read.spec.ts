/**
 * Чтения истории игрока (GAP-55 §11) после переезда из контроллера (G27).
 *
 * Здесь две вещи, которые нельзя проверить юнитом контроллера: форма фильтра,
 * уходящего в БД, и граница IDOR в запросе статусов.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CasinoDatabase from '@casino/database'

const ledgerFindMany = vi.fn<(args: unknown) => Promise<unknown[]>>()
const ledgerCount = vi.fn<(args: unknown) => Promise<number>>()
const paymentFindMany = vi.fn<(args: unknown) => Promise<unknown[]>>()

vi.mock('@casino/database', async (importOriginal) => {
  const actual = await importOriginal<typeof CasinoDatabase>()
  return {
    ...actual,
    prisma: {
      ledgerEntry: {
        findMany: (args: unknown): Promise<unknown[]> => ledgerFindMany(args),
        count: (args: unknown): Promise<number> => ledgerCount(args),
      },
      paymentRequest: {
        findMany: (args: unknown): Promise<unknown[]> => paymentFindMany(args),
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
  ledgerFindMany.mockReset()
  ledgerCount.mockReset()
  paymentFindMany.mockReset()
  ledgerFindMany.mockResolvedValue([])
  ledgerCount.mockResolvedValue(0)
  paymentFindMany.mockResolvedValue([])
})

describe('PrismaWalletRepository.listOwnerEntries', () => {
  it('игрок всегда в фильтре, и в include нет users — это его история, не админский список', async () => {
    await repo.listOwnerEntries({ userId: 'u-1', page: 1, perPage: 20 })

    const args = firstArg(ledgerFindMany)
    expect(args['where']).toEqual({ userId: 'u-1' })
    expect(args['include']).toEqual({ walletAccount: { select: { currency: true } } })
  })

  it('период превращается в gte/lte по createdAt', async () => {
    const from = new Date('2026-09-01T00:00:00.000Z')
    const to = new Date('2026-09-30T23:59:59.999Z')

    await repo.listOwnerEntries({ userId: 'u-1', from, to, page: 1, perPage: 20 })

    expect(firstArg(ledgerFindMany)['where']).toEqual({
      userId: 'u-1',
      createdAt: { gte: from, lte: to },
    })
  })

  it('без периода ключа createdAt нет — иначе граница сломала бы запрос', async () => {
    await repo.listOwnerEntries({ userId: 'u-1', from: undefined, page: 1, perPage: 20 })

    expect(firstArg(ledgerFindMany)['where']).toEqual({ userId: 'u-1' })
  })

  it('валюта — через кошелёк, тип — по колонке проводки', async () => {
    await repo.listOwnerEntries({
      userId: 'u-1',
      currency: 'USDT_TRC20',
      type: 'WITHDRAWAL_LOCK',
      page: 2,
      perPage: 10,
    })

    const args = firstArg(ledgerFindMany)
    expect(args['where']).toEqual({
      userId: 'u-1',
      walletAccount: { currency: 'USDT_TRC20' },
      type: 'WITHDRAWAL_LOCK',
    })
    expect(args['skip']).toBe(10)
    expect(args['take']).toBe(10)
    expect(args['orderBy']).toEqual({ createdAt: 'desc' })
    expect(firstArg(ledgerCount)['where']).toEqual(args['where'])
  })
})

describe('PrismaWalletRepository.findPaymentStatuses', () => {
  it('граница IDOR живёт в запросе: userId и id in — вместе', async () => {
    await repo.findPaymentStatuses('u-1', ['pr-1', 'pr-2'])

    const args = firstArg(paymentFindMany)
    expect(args['where']).toEqual({ userId: 'u-1', id: { in: ['pr-1', 'pr-2'] } })
    expect(args['select']).toEqual({ id: true, status: true })
  })

  it('пустой список id не превращается в «отдай все заявки игрока»', async () => {
    await repo.findPaymentStatuses('u-1', [])

    // Prisma трактует `in: []` как «ни одна строка», то есть пусто, а не без
    // фильтра — проверяем, что мы не потеряли сами ключи where
    expect(firstArg(paymentFindMany)['where']).toEqual({ userId: 'u-1', id: { in: [] } })
  })
})
