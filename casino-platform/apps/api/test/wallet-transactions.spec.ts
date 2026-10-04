/**
 * `GET /wallet/transactions` (GAP-55 §11) — спек был бы не нужен, если бы не
 * переезд чтений на фасады (G27): до него контроллер дергал Prisma сам, и ни
 * одна спека этот эндпоинт не покрывала.
 *
 * Проверяются три вещи, которые видны только на этом уровне: форма ответа
 * (деньги — строки), присоединение статуса заявки к проводке и то, что запрос
 * статусов вообще не происходит, когда присоединять нечего.
 */
import { describe, expect, it, vi } from 'vitest'

import { WalletController } from '../src/modules/wallet/presentation/controllers/wallet.controller'

import type { WalletFacade } from '../src/modules/wallet/facade/wallet.facade'

const USER = { id: 'u-1' }

type Entry = {
  id: string
  transactionId: string
  type: string
  amount: string
  balanceBefore: string
  balanceAfter: string
  description: string | null
  metadata: unknown
  createdAt: Date
  currency: string
}

function entry(overrides: Partial<Entry> = {}): unknown {
  const e: Entry = {
    id: 'le-1',
    transactionId: 'tx-1',
    type: 'DEPOSIT',
    amount: '100.00',
    balanceBefore: '0.00',
    balanceAfter: '100.00',
    description: 'Пополнение',
    metadata: {},
    createdAt: new Date('2026-09-10T12:00:00.000Z'),
    currency: 'RUB',
    ...overrides,
  }
  // Prisma отдаёт Decimal — деньги читаются через toString()
  return {
    id: e.id,
    transactionId: e.transactionId,
    type: e.type,
    amount: { toString: () => e.amount },
    balanceBefore: { toString: () => e.balanceBefore },
    balanceAfter: { toString: () => e.balanceAfter },
    description: e.description,
    metadata: e.metadata,
    createdAt: e.createdAt,
    walletAccount: { currency: e.currency },
  }
}

function makeController(
  fakes: {
    entries?: unknown[]
    total?: number
    statuses?: Array<{ id: string; status: string }>
  } = {},
) {
  const listOwnerTransactions = vi.fn(async (_args: Record<string, unknown>) => ({
    items: (fakes.entries ?? [entry()]) as never,
    total: fakes.total ?? 1,
  }))
  const findPaymentStatuses = vi.fn(async () => (fakes.statuses ?? []) as never)
  const wallet = {
    listOwnerTransactions,
    findPaymentStatuses,
  } as unknown as WalletFacade
  return {
    controller: new WalletController(wallet),
    listOwnerTransactions,
    findPaymentStatuses,
  }
}

describe('GET /wallet/transactions — форма ответа', () => {
  it('деньги строками, валюта из кошелька, payment_status по умолчанию null', async () => {
    const { controller } = makeController()

    const res = await controller.transactions(USER, {})

    expect(res.data[0]).toEqual({
      id: 'le-1',
      transaction_id: 'tx-1',
      type: 'DEPOSIT',
      amount: '100.00',
      currency: 'RUB',
      balance_before: '0.00',
      balance_after: '100.00',
      description: 'Пополнение',
      metadata: {},
      created_at: new Date('2026-09-10T12:00:00.000Z'),
      payment_status: null,
    })
  })

  it('meta считает страницы по total из репозитория, а не по длине страницы', async () => {
    const { controller } = makeController({ entries: [entry()], total: 137 })

    const res = await controller.transactions(USER, { page: '2', per_page: '20' })

    expect(res.meta).toEqual({
      page: 2,
      per_page: 20,
      total: 137,
      total_pages: 7,
      // одна строка на странице при total 137 — страница не последняя
      hasNext: true,
      hasPrev: true,
    })
  })

  it('первая страница не имеет hasPrev, неполная последняя — не имеет hasNext', async () => {
    const { controller } = makeController({ total: 5 })

    const res = await controller.transactions(USER, {})

    expect(res.meta.page).toBe(1)
    expect(res.meta.hasPrev).toBe(false)
    expect(res.meta.hasNext).toBe(false)
  })

  it('per_page сверху ограничен 100, мусор в page — это первая страница', async () => {
    const { controller, listOwnerTransactions } = makeController()

    const res = await controller.transactions(USER, { page: 'abc', per_page: '5000' })

    expect(res.meta.page).toBe(1)
    expect(res.meta.per_page).toBe(100)
    expect(listOwnerTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, perPage: 100 }),
    )
  })
})

describe('GET /wallet/transactions — фильтр и период', () => {
  it('filters уходят владельцу чтения, границы периода — сутки целиком', async () => {
    const { controller, listOwnerTransactions } = makeController()

    await controller.transactions(USER, {
      currency: 'USDT_TRC20',
      type: 'WITHDRAWAL_LOCK',
      from: '2026-09-01',
      to: '2026-09-30',
    })

    expect(listOwnerTransactions).toHaveBeenCalledWith({
      userId: 'u-1',
      type: 'WITHDRAWAL_LOCK',
      currency: 'USDT_TRC20',
      from: new Date('2026-09-01T00:00:00.000Z'),
      to: new Date('2026-09-30T23:59:59.999Z'),
      page: 1,
      perPage: 20,
    })
  })

  it('без периода ключей from/to нет — пустой строкой их не задают', async () => {
    const { controller, listOwnerTransactions } = makeController()

    await controller.transactions(USER, {})

    const args = listOwnerTransactions.mock.calls[0]![0] as Record<string, unknown>
    expect(args['from']).toBeUndefined()
    expect(args['to']).toBeUndefined()
    expect(args['userId']).toBe('u-1')
  })
})

describe('GET /wallet/transactions — статус заявки в строке журнала', () => {
  it('проводка со ссылкой получает статус её заявки, остальные остаются с null', async () => {
    const { controller, findPaymentStatuses } = makeController({
      entries: [
        entry({ id: 'le-1', metadata: { payment_request_id: 'pr-1' } }),
        entry({ id: 'le-2', metadata: { payment_request_id: 'pr-9' } }),
        entry({ id: 'le-3', metadata: {} }),
      ],
      total: 3,
      statuses: [{ id: 'pr-1', status: 'processing' }],
    })

    const res = await controller.transactions(USER, {})

    // один запрос на всю страницу (не N+1), и только по id со ссылками
    expect(findPaymentStatuses).toHaveBeenCalledWith('u-1', ['pr-1', 'pr-9'])
    expect(res.data.map((row) => row.payment_status)).toEqual(['processing', null, null])
  })

  it('строки без ссылки на заявку не вызывают запрос статусов вовсе', async () => {
    const { controller, findPaymentStatuses } = makeController({
      entries: [entry({ metadata: {} }), entry({ id: 'le-2', metadata: null })],
    })

    const res = await controller.transactions(USER, {})

    expect(findPaymentStatuses).not.toHaveBeenCalled()
    expect(res.data.every((row) => row.payment_status === null)).toBe(true)
  })
})
