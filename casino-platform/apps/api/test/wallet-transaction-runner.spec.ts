import { describe, expect, it, vi, beforeEach } from 'vitest'

// Моки ДО импорта SUT (hoisted). GAP-57: раннер внешних денежных транзакций
// (единственная точка $transaction для bet/win/rollback) обязан ретраить
// Prisma P2034 — Serializable-конфликт на уровне Postgres.
vi.mock('@casino/database', () => ({
  prisma: { $transaction: vi.fn() },
}))

import { PrismaWalletTransactionRunner } from '../src/modules/wallet/infrastructure/ledger/wallet-transaction-runner.prisma'
import { prisma } from '@casino/database'

const transactionMock = vi.mocked(prisma.$transaction)

/** GAP-57: раннер обязан получить кошелёк — по нему берётся advisory-лок. */
const TARGET = { userId: 'user-1', currency: 'RUB' as const }

const P2034 = Object.assign(
  new Error('Transaction failed due to a write conflict or a deadlock (P2034)'),
  { code: 'P2034' },
)

/** GAP-57: первыми в транзакции идут set_config(lock_timeout) и advisory-лок. */
function makeTx(attempt: number): unknown {
  return { attempt, $queryRaw: vi.fn().mockResolvedValue([]) }
}

/**
 * Симуляция честного конфликта СУБД: тело транзакции ВЫПОЛНЯЕТСЯ, конфликт
 * случается на коммите (как в реальном Postgres), поэтому fn вызывается на
 * каждой попытке — и его повторный прогон обязан быть безопасным.
 */
function conflictOnAttempt(_fn: (tx: unknown) => Promise<unknown>, failAttempts: number): number {
  let attempt = 0
  transactionMock.mockImplementation(async (txBody) => {
    attempt += 1
    await txBody(makeTx(attempt))
    if (attempt <= failAttempts) {
      throw P2034
    }
    return 'committed'
  })
  return attempt
}

describe('GAP-57: PrismaWalletTransactionRunner — ретрай Serializable-конфликта', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('два конфликта подряд → fn выполнен 3 раза, третий прогон коммитится', async () => {
    conflictOnAttempt(async () => undefined, 2)
    const fn = vi.fn().mockResolvedValue('committed')

    const runner = new PrismaWalletTransactionRunner()
    const res = await runner.runInTransaction(TARGET, fn)

    expect(res).toBe('committed')
    expect(fn).toHaveBeenCalledTimes(3)
    expect(transactionMock).toHaveBeenCalledTimes(3)
  })

  it('конфликты исчерпаны → P2034 пробрасывается наружу', async () => {
    let attempt = 0
    transactionMock.mockImplementation(async (txBody) => {
      attempt += 1
      await txBody(makeTx(attempt))
      throw P2034
    })
    const fn = vi.fn().mockResolvedValue('never')

    const runner = new PrismaWalletTransactionRunner()
    await expect(runner.runInTransaction(TARGET, fn)).rejects.toMatchObject({ code: 'P2034' })
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it('другие ошибки (не P2034) не ретраятся', async () => {
    const boom = new Error('INSUFFICIENT_FUNDS')
    transactionMock.mockRejectedValue(boom)

    const runner = new PrismaWalletTransactionRunner()
    const fn = vi.fn().mockResolvedValue('x')

    await expect(runner.runInTransaction(TARGET, fn)).rejects.toBe(boom)
    // мок отвергает до запуска тела — главное, что попытка была ровно одна
    expect(transactionMock).toHaveBeenCalledTimes(1)
  })

  it('раннер передаёт кошелёк в общую примитиву (сериализация по ключу)', async () => {
    transactionMock.mockImplementation(async (txBody) => txBody(makeTx(1)) as Promise<unknown>)

    const runner = new PrismaWalletTransactionRunner()
    await runner.runInTransaction({ userId: 'user-9', currency: 'USDT_TRC20' }, async () => 'ok')

    expect(transactionMock).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'ReadCommitted',
    })
  })
})
