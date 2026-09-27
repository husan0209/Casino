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

const P2034 = Object.assign(
  new Error('Transaction failed due to a write conflict or a deadlock (P2034)'),
  { code: 'P2034' },
)

/**
 * Симуляция честного Serializable-конфликта: тело транзакции ВЫПОЛНЯЕТСЯ,
 * конфликт случается на коммите (как в реальном Postgres), поэтому fn
 * вызывается на каждой попытке — и его повторный прогон обязан быть безопасным.
 */
function conflictOnAttempt(fn: (tx: unknown) => Promise<unknown>, failAttempts: number): number {
  let attempt = 0
  transactionMock.mockImplementation(async (txBody) => {
    attempt += 1
    await txBody({ attempt })
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
    const res = await runner.runInTransaction(fn)

    expect(res).toBe('committed')
    expect(fn).toHaveBeenCalledTimes(3)
    expect(transactionMock).toHaveBeenCalledTimes(3)
  })

  it('три конфликта → попытки исчерпаны, P2034 пробрасывается наружу', async () => {
    conflictOnAttempt(async () => undefined, 3)
    const fn = vi.fn().mockResolvedValue('never')

    const runner = new PrismaWalletTransactionRunner()
    await expect(runner.runInTransaction(fn)).rejects.toMatchObject({ code: 'P2034' })
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('другие ошибки (не P2034) не ретраятся', async () => {
    const boom = new Error('INSUFFICIENT_FUNDS')
    transactionMock.mockRejectedValue(boom)

    const runner = new PrismaWalletTransactionRunner()
    const fn = vi.fn().mockResolvedValue('x')

    await expect(runner.runInTransaction(fn)).rejects.toBe(boom)
    // мок отвергает до запуска тела — главное, что попытка была ровно одна
    expect(transactionMock).toHaveBeenCalledTimes(1)
  })
})
