/**
 * Админские чтения платежей (G27): какой именно запрос уходит в БД.
 *
 * Перенос чтения из `admin-finance.controller.ts` к владельцу таблицы формы
 * ответа не меняет — и ровно поэтому его надо проверить: опечатка в `include`,
 * потерянный `orderBy` или фильтр, уехавший не в ту колонку, не роняют ничего,
 * они молча дают админу не тот список.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CasinoDatabase from '@casino/database'

const findMany = vi.fn<(args: unknown) => Promise<unknown[]>>()
const count = vi.fn<(args: unknown) => Promise<number>>()
const findUnique = vi.fn<(args: unknown) => Promise<unknown>>()

vi.mock('@casino/database', async (importOriginal) => {
  const actual = await importOriginal<typeof CasinoDatabase>()
  return {
    ...actual,
    prisma: {
      paymentRequest: {
        findMany: (args: unknown): Promise<unknown[]> => findMany(args),
        count: (args: unknown): Promise<number> => count(args),
        findUnique: (args: unknown): Promise<unknown> => findUnique(args),
      },
    },
  }
})

import { PaymentRequestRepository } from './payment-request.repository'

const repo = new PaymentRequestRepository()

function firstArg(mock: { mock: { calls: unknown[][] } }): Record<string, unknown> {
  return mock.mock.calls[0]![0] as Record<string, unknown>
}

beforeEach(() => {
  findMany.mockReset()
  count.mockReset()
  findUnique.mockReset()
  findMany.mockResolvedValue([])
  count.mockResolvedValue(0)
})

describe('PaymentRequestRepository.listAdmin', () => {
  it('без фильтров — пустой where, сортировка по созданию и пагинация', async () => {
    await repo.listAdmin({ page: 2, perPage: 50 })

    const args = firstArg(findMany)
    expect(args['where']).toEqual({})
    expect(args['skip']).toBe(50)
    expect(args['take']).toBe(50)
    expect(args['orderBy']).toEqual({ createdAt: 'desc' })
    expect(args['include']).toEqual({ user: { select: { email: true } } })
    // счётчик — по ТОМУ ЖЕ where: meta.total не должен считать всю таблицу
    expect(firstArg(count)['where']).toEqual({})
  })

  it('фильтры попадают в where только когда переданы', async () => {
    await repo.listAdmin({
      userId: 'u-1',
      status: 'completed',
      page: 1,
      perPage: 20,
    })

    expect(firstArg(findMany)['where']).toEqual({ userId: 'u-1', status: 'completed' })
  })

  it('provider/type/currency фильтруются по своим колонкам заявки', async () => {
    await repo.listAdmin({
      type: 'deposit',
      provider: 'nowpayments',
      currency: 'USDT_TRC20',
      page: 1,
      perPage: 20,
    })

    expect(firstArg(findMany)['where']).toEqual({
      type: 'deposit',
      provider: 'nowpayments',
      currency: 'USDT_TRC20',
    })
  })

  it('undefined-фильтры не превращаются в ключи where', async () => {
    // exactOptionalPropertyTypes + контроллер, передающий q.user_id напрямую:
    // `{ userId: undefined }` в Prisma означает «фильтровать по NULL», а не «нет
    // фильтра» — список админки стал бы пустым без единого признака в URL
    await repo.listAdmin({ userId: undefined, status: undefined, page: 1, perPage: 20 })

    expect(firstArg(findMany)['where']).toEqual({})
  })
})

describe('PaymentRequestRepository.findDetail', () => {
  it('карточка тянет колбэки провайдера и email игрока', async () => {
    findUnique.mockResolvedValue({ id: 'pr-1', callbacks: [], user: { email: 'p@example.com' } })

    const row = await repo.findDetail('pr-1')

    const args = firstArg(findUnique)
    expect(args['where']).toEqual({ id: 'pr-1' })
    expect(args['include']).toEqual({
      callbacks: true,
      user: { select: { email: true } },
    })
    expect(row).toMatchObject({ id: 'pr-1' })
  })

  it('нет заявки — null, а не исключение (контроллер отдаёт payment_request: null)', async () => {
    findUnique.mockResolvedValue(null)

    expect(await repo.findDetail('missing')).toBeNull()
  })
})
