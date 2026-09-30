import { beforeEach, describe, expect, it, vi } from 'vitest'

// Моки ДО импорта SUT (hoisted). GAP-57: сериализация конкурентных мутаций
// одного кошелька — advisory-лок (pg_advisory_xact_lock) + ReadCommitted.
// Лок берётся ПЕРВЫМ внутри транзакции, до чтения wallet_accounts.
vi.mock('@casino/database', () => ({
  prisma: { $transaction: vi.fn() },
}))

import { prisma } from '@casino/database'

import { OptimisticLockError } from '../src/modules/wallet/domain/errors'
import { runWalletTransaction } from '../src/modules/wallet/infrastructure/ledger/wallet-transaction-lock'

const transactionMock = vi.mocked(prisma.$transaction)

const TARGET = { userId: 'user-1', currency: 'RUB' as const }

/** Prisma-клиент транзакции: фиксируем порядок запросов (лока ДО чтения). */
function makeTx(calls: string[] = []) {
  return {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push(['lock_timeout', strings.join('?')].join(':'))
      void values
      return []
    }),
    walletAccount: {
      findUnique: vi.fn(async () => {
        calls.push('read-wallet')
        return {
          id: 'wallet-1',
          createdAt: new Date(),
          updatedAt: new Date(),
          userId: 'user-1',
          currency: 'RUB',
          balance: { toString: () => '100.00' },
          locked: { toString: () => '0.00' },
          version: 1n,
        }
      }),
      updateMany: vi.fn(async () => {
        calls.push('update-wallet')
        return { count: 1 }
      }),
    },
    ledgerEntry: {
      create: vi.fn(async () => {
        calls.push('insert-ledger')
        return { id: 'ledger-1', createdAt: new Date() }
      }),
    },
  }
}

function conflictOnAttempt(failAttempts: number, calls: string[]): number {
  let attempt = 0
  transactionMock.mockImplementation(async (txBody) => {
    attempt += 1
    await txBody(makeTx(calls) as never)
    if (attempt <= failAttempts) {
      throw Object.assign(new Error('write conflict or deadlock'), { code: 'P2034' })
    }
    return 'committed'
  })
  return attempt
}

describe('GAP-57: runWalletTransaction — advisory-лок на кошелёк + ReadCommitted', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('берёт advisory-лок ДО чтения кошелька (иначе лок не защищает read-modify-write)', async () => {
    const calls: string[] = []
    transactionMock.mockImplementation(async (txBody) =>
      txBody(makeTx(calls) as never) as Promise<unknown>,
    )

    const res = await runWalletTransaction(TARGET, async (tx) => {
      const wallet = await tx.walletAccount.findUnique({
        where: { userId_currency: { userId: 'user-1', currency: 'RUB' } },
      })
      return wallet?.balance.toString()
    })

    expect(res).toBe('100.00')
    expect(calls[0]).toContain('lock_timeout')
    expect(calls.indexOf('read-wallet')).toBeGreaterThan(0)
    // лок — ПЕРВАЯ операция в транзакции
    expect(calls.findIndex((c) => c.includes('lock_timeout'))).toBe(0)
  })

  it('транзакция идёт на ReadCommitted, а не Serializable (лок уже сериализует)', async () => {
    transactionMock.mockImplementation(async (txBody) => txBody(makeTx() as never) as Promise<unknown>)

    await runWalletTransaction(TARGET, async () => 'ok')

    expect(transactionMock).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'ReadCommitted',
    })
  })

  it('ключ лока различает игроков и валюты (блокируется только свой кошелёк)', async () => {
    const seen: string[] = []
    transactionMock.mockImplementation(async (txBody) => {
      const tx = makeTx()
      const original = tx.$queryRaw
      tx.$queryRaw = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
        // первый $queryRaw — set_config(lock_timeout), интересует только лок
        if (strings.join('').includes('pg_advisory_xact_lock')) {
          seen.push(String(values[0]))
          // pg_advisory_xact_lock возвращает void — приводим к text, иначе
          // Prisma не десериализует результат (поймано интеграционным тестом).
          expect(strings.join('')).toContain('::text')
        }
        return original(strings, ...values)
      }) as typeof tx.$queryRaw
      return txBody(tx as never) as Promise<unknown>
    })

    const body = async () => 'ok'
    await runWalletTransaction({ userId: 'user-1', currency: 'RUB' }, body)
    await runWalletTransaction({ userId: 'user-2', currency: 'RUB' }, body)
    await runWalletTransaction({ userId: 'user-1', currency: 'USDT_TRC20' }, body)

    expect(seen[0]).toBe('casino.wallet:user-1:RUB')
    expect(seen[1]).toBe('casino.wallet:user-2:RUB')
    expect(seen[2]).toBe('casino.wallet:user-1:USDT_TRC20')
    expect(new Set(seen).size).toBe(3)
  })

  it('два конфликта подряд → третья попытка коммитится (body переигран)', async () => {
    const calls: string[] = []
    const attempts = conflictOnAttempt(2, calls)
    const body = vi.fn().mockResolvedValue('committed')

    const res = await runWalletTransaction(TARGET, body)

    expect(res).toBe('committed')
    expect(body).toHaveBeenCalledTimes(3)
    expect(transactionMock).toHaveBeenCalledTimes(3)
  })

  it('OptimisticLockError (конфликт версии) ретраится, а не уходит к игроку', async () => {
    let attempt = 0
    transactionMock.mockImplementation(async (txBody) => {
      attempt += 1
      await txBody(makeTx() as never)
      if (attempt <= 2) {
        throw new OptimisticLockError()
      }
      return 'committed'
    })

    const res = await runWalletTransaction(TARGET, async () => 'committed')

    expect(res).toBe('committed')
    expect(transactionMock).toHaveBeenCalledTimes(3)
  })

  it('lock_timeout (55P03) ретраится — не «залипающая» ошибка игроку', async () => {
    let attempt = 0
    transactionMock.mockImplementation(async (txBody) => {
      attempt += 1
      await txBody(makeTx() as never)
      if (attempt <= 1) {
        throw Object.assign(new Error('canceling statement due to lock timeout'), {
          code: '55P03',
        })
      }
      return 'committed'
    })

    await expect(runWalletTransaction(TARGET, async () => 'committed')).resolves.toBe('committed')
    expect(transactionMock).toHaveBeenCalledTimes(2)
  })

  it('исчерпание попыток → ошибка пробрасывается наружу (деньги не теряются)', async () => {
    transactionMock.mockRejectedValue(
      Object.assign(new Error('write conflict or deadlock'), { code: 'P2034' }),
    )

    await expect(runWalletTransaction(TARGET, async () => 'never')).rejects.toMatchObject({
      code: 'P2034',
    })
    expect(transactionMock.mock.calls.length).toBeGreaterThanOrEqual(5)
  })

  it('доменная ошибка (INSUFFICIENT_FUNDS) не ретраится — повтор был бы двойным списанием', async () => {
    const insufficient = Object.assign(new Error('Insufficient funds'), {
      code: 'INSUFFICIENT_FUNDS',
    })
    transactionMock.mockImplementation(async (txBody) => {
      await txBody(makeTx() as never)
      throw insufficient
    })

    await expect(runWalletTransaction(TARGET, async () => 'never')).rejects.toBe(insufficient)
    expect(transactionMock).toHaveBeenCalledTimes(1)
  })
})
