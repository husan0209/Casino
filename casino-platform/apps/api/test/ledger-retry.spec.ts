import { beforeEach, describe, expect, it, vi } from 'vitest'

// Моки ДО импорта SUT (hoisted). GAP-57: withRetry обязан ретраить не только
// app-level OptimisticLockError, но и Prisma P2034 — Serializable-конфликт на
// уровне Postgres, который приходит ДО запуска app-кода внутри транзакции.
vi.mock('@casino/database', () => ({
  prisma: {
    $transaction: vi.fn(),
    ledgerEntry: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}))

import { prisma } from '@casino/database'

import { PrismaWalletLedger } from '../src/modules/wallet/infrastructure/ledger/wallet.ledger.prisma'

import type { MockedFunction } from 'vitest'

/**
 * `$transaction` в Prisma перегружен (массив промисов | колбэк с клиентом транзакции),
 * а спеке нужна только колбэк-ветка с урезанным клиентом из `makeTx()`. Тип выводим
 * сами: `vi.mocked` от оригинала не позволяет описатьImplementation одной веткой.
 */
type TransactionMock = MockedFunction<(fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>>

const transactionMock = prisma.$transaction as unknown as TransactionMock

const P2034 = Object.assign(
  new Error(
    'Invalid `tx.walletAccount.updateMany()` invocation in D:\\projects\\Casino\\casino-platform\\apps\\api\\src: Transaction failed due to a write conflict or a deadlock (P2034)',
  ),
  { code: 'P2034' },
)

function makeTx(): unknown {
  return {
    // GAP-57: первыми идут advisory-лок и set_config(lock_timeout)
    $queryRaw: vi.fn().mockResolvedValue([]),
    walletAccount: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'wallet-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        userId: 'user-1',
        currency: 'RUB',
        balance: { toString: () => '100.00' },
        locked: { toString: () => '0.00' },
        version: 1n,
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    ledgerEntry: {
      create: vi.fn().mockResolvedValue({ id: 'ledger-1', createdAt: new Date() }),
    },
  }
}

describe('GAP-57: withRetry — Prisma P2034 (Serializable write conflict) ретраится', () => {
  let ledger: PrismaWalletLedger

  beforeEach(() => {
    vi.clearAllMocks()
    ledger = new PrismaWalletLedger()
  })

  it('две подряд P2034 → третья попытка успешна, $transaction вызван 3 раза', async () => {
    const tx = makeTx()
    transactionMock
      .mockRejectedValueOnce(P2034)
      .mockRejectedValueOnce(P2034)
      .mockImplementationOnce(async (txBody: (t: unknown) => Promise<unknown>) => txBody(tx))

    const res = await ledger.lock({
      userId: 'user-1',
      currency: 'RUB',
      amount: '10.00',
      idempotencyKey: 'wd_lock_retry-1',
    })

    expect(res.ledgerEntryId).toBe('ledger-1')
    expect(res.duplicate).toBe(false)
    expect(transactionMock).toHaveBeenCalledTimes(3)
  })

  it('конфликты исчерпаны → ошибка пробрасывается наружу', async () => {
    transactionMock.mockRejectedValue(P2034)

    await expect(
      ledger.lock({
        userId: 'user-1',
        currency: 'RUB',
        amount: '10.00',
        idempotencyKey: 'wd_lock_retry-2',
      }),
    ).rejects.toMatchObject({ code: 'P2034' })
    expect(transactionMock.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it('без конфликтов — одна транзакция, ретраев нет', async () => {
    const tx = makeTx()
    transactionMock.mockImplementationOnce(async (txBody: (t: unknown) => Promise<unknown>) =>
      txBody(tx),
    )

    const res = await ledger.lock({
      userId: 'user-1',
      currency: 'RUB',
      amount: '10.00',
      idempotencyKey: 'wd_lock_retry-3',
    })

    expect(res.duplicate).toBe(false)
    expect(transactionMock).toHaveBeenCalledTimes(1)
  })
})
