/**
 * Чтение депозитов игрока для квалификации атрибуций (GAP-64/ТЗ ч.8 §7.4).
 *
 * Здесь живёт единственная вещь, которую нельзя проверить юнитом use case'а:
 * какое именно условие уходит в БД. Ошибка на пару символов (не тот `type`,
 * не тот `status`, сумма не в `amount_rub`) не роняет ничего — она просто
 * делает партнёров неквалифицируемыми или квалифицирует не по тем деньгам.
 *
 * Сумма берётся из `amount_rub`, а не из `amount`: порог `affiliate_min_deposit`
 * задан в рублях, а у крипто-заявки `amount` — в единицах монеты.
 */
import { Decimal } from 'decimal.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CasinoDatabase from '@casino/database'

const aggregate = vi.fn<(args: unknown) => Promise<unknown>>()
const findFirst = vi.fn<(args: unknown) => Promise<unknown>>()

vi.mock('@casino/database', async (importOriginal) => {
  const actual = await importOriginal<typeof CasinoDatabase>()
  return {
    ...actual,
    prisma: {
      paymentRequest: {
        aggregate: (args: unknown): Promise<unknown> => aggregate(args),
        findFirst: (args: unknown): Promise<unknown> => findFirst(args),
      },
    },
  }
})

import { PrismaAffiliateAttributionRepository } from './affiliate.prisma.repository'

const repo = new PrismaAffiliateAttributionRepository()

beforeEach(() => {
  aggregate.mockReset()
  findFirst.mockReset()
})

describe('PrismaAffiliateAttributionRepository.sumPlayerDeposits', () => {
  it('считает только завершённые пополнения и в рублях', async () => {
    aggregate.mockResolvedValue({ _sum: { amountRub: new Decimal('1234.5') }, _count: { _all: 3 } })
    findFirst.mockResolvedValue({
      id: 'pay-1',
      completedAt: new Date('2026-02-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-30T00:00:00.000Z'),
      amountRub: new Decimal('250'),
    })

    const res = await repo.sumPlayerDeposits('player-1')

    const aggArgs = aggregate.mock.calls[0]![0] as {
      where: Record<string, unknown>
      _sum: Record<string, unknown>
    }
    expect(aggArgs.where).toEqual({ userId: 'player-1', type: 'deposit', status: 'completed' })
    expect(aggArgs._sum).toEqual({ amountRub: true })
    const firstArgs = findFirst.mock.calls[0]![0] as {
      where: Record<string, unknown>
      orderBy: unknown
      select: Record<string, unknown>
    }
    expect(firstArgs.where).toEqual(aggArgs.where)
    expect(firstArgs.orderBy).toEqual({ createdAt: 'asc' })
    // amountRub в select обязателен: без него F4 сравнивает с порогом ноль
    expect(firstArgs.select).toEqual({
      id: true,
      completedAt: true,
      createdAt: true,
      amountRub: true,
    })
    expect(res).toEqual({
      totalRub: '1234.50000000',
      count: 3,
      firstDepositId: 'pay-1',
      firstDepositAt: new Date('2026-02-01T00:00:00.000Z'),
      firstAmountRub: '250.00000000',
    })
  })

  it('нет завершённых пополнений — ноль и пустые отметки, второго запроса нет', async () => {
    aggregate.mockResolvedValue({ _sum: { amountRub: null }, _count: { _all: 0 } })

    const res = await repo.sumPlayerDeposits('player-2')

    expect(res).toEqual({
      totalRub: '0',
      count: 0,
      firstDepositId: null,
      firstDepositAt: null,
      firstAmountRub: null,
    })
    expect(findFirst).not.toHaveBeenCalled()
  })

  it('агрегат по колонке без значений даёт нулевую сумму, а не null', async () => {
    aggregate.mockResolvedValue({ _sum: { amountRub: null }, _count: { _all: 2 } })
    findFirst.mockResolvedValue({
      id: 'pay-3',
      completedAt: new Date('2026-03-03T00:00:00.000Z'),
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      amountRub: null,
    })

    const res = await repo.sumPlayerDeposits('player-3')

    expect(res.totalRub).toBe('0')
    expect(res.count).toBe(2)
    // NULL в amount_rub остаётся null, а не превращается в '0': ноль выглядит
    // как «депозит впритык к нулевому порогу», и флаг висял бы на пустых данных
    expect(res.firstAmountRub).toBeNull()
  })

  it('у completed-заявки без completedAt датой считается createdAt', async () => {
    // completedAt nullable в схеме; без fallback квалификация встала бы навсегда
    aggregate.mockResolvedValue({ _sum: { amountRub: new Decimal('500') }, _count: { _all: 1 } })
    findFirst.mockResolvedValue({
      id: 'pay-4',
      completedAt: null,
      createdAt: new Date('2026-04-04T00:00:00.000Z'),
      amountRub: new Decimal('500'),
    })

    const res = await repo.sumPlayerDeposits('player-4')

    expect(res.firstDepositAt).toEqual(new Date('2026-04-04T00:00:00.000Z'))
    expect(res.firstDepositId).toBe('pay-4')
    expect(res.firstAmountRub).toBe('500.00000000')
  })
})
