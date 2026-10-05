/**
 * Списки кассы админки (UC-PAY-16/17/18/10) после переезда на фасады (G27).
 *
 * Проверяется то, что нельзя увидеть в спеках репозитория: как query-параметры
 * превращаются в аргументы чтения владельца таблицы. Контракт формы ответа при
 * этом не меняется — админский фронт reads `items`/`meta` ровно так же, поэтому
 * здесь он и зафиксирован.
 */
import { describe, expect, it, vi } from 'vitest'

import { AdminFinanceController } from '../src/modules/admin/presentation/controllers/admin-finance.controller'
import {
  AdminPaymentRequestsQuerySchema,
  AdminTransactionsQuerySchema,
  AdminWithdrawalsQuerySchema,
} from '../src/modules/admin/presentation/dto/admin-finance.dto'

import type {
  PaymentRequestAdminRow,
  PaymentsFacade,
} from '../src/modules/payments/facade/payments.facade'
import type { LedgerEntryAdminRow, WalletFacade } from '../src/modules/wallet/facade/wallet.facade'

/** Минимальная форма: контроллер сериализует строку как есть, поля не трогает. */
const LEDGER_ROW = {
  id: 'le-1',
  userId: 'u-1',
  type: 'DEPOSIT',
  amount: '100.00',
  walletAccount: { currency: 'RUB' },
  user: { email: 'player@example.com' },
} as unknown as LedgerEntryAdminRow

const PR_ROW = {
  id: 'pr-1',
  userId: 'u-1',
  type: 'withdrawal',
  status: 'pending',
  currency: 'RUB',
  user: { email: 'player@example.com' },
} as unknown as PaymentRequestAdminRow

function makeController(
  fakes: {
    ledger?: LedgerEntryAdminRow[]
    ledgerTotal?: number
    requests?: PaymentRequestAdminRow[]
    requestsTotal?: number
    ledgerForPaymentError?: boolean
  } = {},
) {
  const listLedgerEntries = vi.fn(
    async (): Promise<{ items: LedgerEntryAdminRow[]; total: number }> => ({
      items: fakes.ledger ?? [LEDGER_ROW],
      total: fakes.ledgerTotal ?? 1,
    }),
  )
  const listEntriesForPaymentRequest = vi.fn(async (): Promise<unknown[]> =>
    fakes.ledgerForPaymentError === true ? Promise.reject(new Error('ledger read failed')) : [],
  )
  const wallet = {
    listLedgerEntries,
    listEntriesForPaymentRequest,
  } as unknown as WalletFacade

  const listPaymentRequests = vi.fn(
    async (): Promise<{ items: PaymentRequestAdminRow[]; total: number }> => ({
      items: fakes.requests ?? [PR_ROW],
      total: fakes.requestsTotal ?? 1,
    }),
  )
  const getPaymentRequestDetail = vi.fn(async (id: string): Promise<unknown> => ({
    id,
    callbacks: [{ id: 'cb-1', provider: 'nowpayments' }],
    user: { email: 'player@example.com' },
  }))
  const paymentsFacade = {
    listPaymentRequests,
    getPaymentRequestDetail,
  } as unknown as PaymentsFacade

  const controller = new AdminFinanceController(wallet, {} as never, {} as never, paymentsFacade)
  return { controller, listLedgerEntries, listPaymentRequests, listEntriesForPaymentRequest }
}

describe('GET /admin/transactions', () => {
  it('snake_case query превращается в аргументы чтения wallet', async () => {
    const { controller, listLedgerEntries } = makeController()

    const res = await controller.transactions(
      AdminTransactionsQuerySchema.parse({
        page: '2',
        per_page: '30',
        user_id: 'u-1',
        type: 'DEPOSIT',
        currency: 'RUB',
      }),
    )

    expect(listLedgerEntries).toHaveBeenCalledWith({
      userId: 'u-1',
      type: 'DEPOSIT',
      currency: 'RUB',
      page: 2,
      perPage: 30,
    })
    expect(res.items).toEqual([LEDGER_ROW])
    expect(res.meta).toEqual({ page: 2, perPage: 30, total: 1 })
  })

  it('без фильтров идут дефолты схемы, а в репозиторий — undefined, а не пустые строки', async () => {
    const { controller, listLedgerEntries } = makeController()

    const res = await controller.transactions(AdminTransactionsQuerySchema.parse({}))

    expect(listLedgerEntries).toHaveBeenCalledWith({
      userId: undefined,
      type: undefined,
      currency: undefined,
      page: 1,
      perPage: 50,
    })
    expect(res.meta).toEqual({ page: 1, perPage: 50, total: 1 })
  })
})

describe('GET /admin/payment-requests и /admin/withdrawals', () => {
  it('список заявок прокидывает фильтры владельца таблицы', async () => {
    const { controller, listPaymentRequests } = makeController()

    await controller.paymentRequests(
      AdminPaymentRequestsQuerySchema.parse({
        user_id: 'u-2',
        type: 'deposit',
        status: 'completed',
        provider: 'rukassa',
        per_page: '10',
      }),
    )

    expect(listPaymentRequests).toHaveBeenCalledWith({
      userId: 'u-2',
      type: 'deposit',
      status: 'completed',
      provider: 'rukassa',
      page: 1,
      perPage: 10,
    })
  })

  it('withdrawals всегда про type=withdrawal — тип нельзя подменить запросом', async () => {
    const { controller, listPaymentRequests } = makeController()

    await controller.withdrawals(
      AdminWithdrawalsQuerySchema.parse({ status: 'pending', currency: 'USDT_TRC20' }),
    )

    expect(listPaymentRequests).toHaveBeenCalledWith({
      type: 'withdrawal',
      userId: undefined,
      status: 'pending',
      currency: 'USDT_TRC20',
      page: 1,
      perPage: 50,
    })
  })
})

describe('GET /admin/payment-requests/:id', () => {
  it('карточка собирает заявку от payments и проводки — от wallet', async () => {
    const { controller, listEntriesForPaymentRequest } = makeController()

    const res = await controller.paymentDetail('pr-1')

    expect(res.payment_request).toMatchObject({ id: 'pr-1' })
    expect(res.callbacks).toEqual([{ id: 'cb-1', provider: 'nowpayments' }])
    expect(listEntriesForPaymentRequest).toHaveBeenCalledWith('pr-1')
    expect(res.ledger_entries).toEqual([])
  })

  it('сбой чтения журнала не превращает карточку в 500: блок справочный', async () => {
    const { controller } = makeController({ ledgerForPaymentError: true })

    const res = await controller.paymentDetail('pr-1')

    expect(res.payment_request).toMatchObject({ id: 'pr-1' })
    expect(res.ledger_entries).toEqual([])
  })
})

describe('валидация формы списков', () => {
  it('мусорный enum фильтра отклоняется схемой, а не уходит в Prisma', () => {
    // раньше `?type=какашка` доходил до Prisma и давал 500: GlobalExceptionFilter
    // прячет не-HttpException в generic INTERNAL_ERROR, то есть это выглядело как
    // поломка сервера, а не как неверный запрос
    expect(AdminTransactionsQuerySchema.safeParse({ type: 'NOT_A_LEDGER_TYPE' }).success).toBe(
      false,
    )
    expect(AdminPaymentRequestsQuerySchema.safeParse({ status: 'какашка' }).success).toBe(false)
    expect(AdminWithdrawalsQuerySchema.safeParse({ currency: 'EUR' }).success).toBe(false)
  })

  it('перенесённое поведение пагинации: потолок per_page 200 и дефолт 50', () => {
    expect(AdminTransactionsQuerySchema.parse({ per_page: '5000' }).per_page).toBe(200)
    expect(AdminTransactionsQuerySchema.parse({}).per_page).toBe(50)
    expect(AdminTransactionsQuerySchema.parse({}).page).toBe(1)
  })

  it('некорректные page/per_page отсекаются, а не превращаются в «всё»', () => {
    expect(AdminTransactionsQuerySchema.safeParse({ page: '0' }).success).toBe(false)
    expect(AdminTransactionsQuerySchema.safeParse({ page: '-5' }).success).toBe(false)
    expect(AdminTransactionsQuerySchema.safeParse({ per_page: 'abc' }).success).toBe(false)
  })
})
