/**
 * Интеграционные тесты wallet ledger на реальном Postgres (P2, GAP-24 остаток).
 *
 * Запускаются ТОЛЬКО при LEDGER_INTEGRATION=1 (в CI: job lint-typecheck-test
 * поднимает postgres-сервис + шаг `prisma db push`). Локально скипаются —
 * Postgres в dev-окружении не гарантирован.
 *
 * ВАЖНО про структуру: describe-колбэк НЕ async и не содержит бизнес-кода —
 * vitest исполняет async describe-callback даже у describe.skip (движок Prisma
 * грузился бы на ARM-машинах). Весь код — только внутри it().
 *
 * Проверяют то, что in-memory money-flow тесты из money-flow.spec.ts
 * проверить не могут: реальную семантику Serializable-транзакций,
 * откат при сбое и поведение optimistic-lock на настоящей БД.
 */
import { randomUUID } from 'crypto'

import { prisma } from '@casino/database'

import { InsufficientFundsError } from '../src/modules/wallet/domain/errors'
import { PrismaWalletTransactionRunner } from '../src/modules/wallet/infrastructure/ledger/wallet-transaction-runner.prisma'
import { PrismaWalletLedger } from '../src/modules/wallet/infrastructure/ledger/wallet.ledger.prisma'
import type { CreditInput } from '../src/modules/wallet/domain/repositories/wallet.repository'

const INTEGRATION = process.env['LEDGER_INTEGRATION'] === '1'
const dDb = INTEGRATION ? describe : describe.skip

const ledger = new PrismaWalletLedger()
const txRunner = new PrismaWalletTransactionRunner()

const createdUserIds: string[] = []

async function makeUser(): Promise<string> {
  const u = await prisma.user.create({
    data: { referralCode: ('it' + randomUUID()).slice(0, 32) },
  })
  createdUserIds.push(u.id)
  return u.id
}

function creditInput(userId: string, overrides: Partial<CreditInput> = {}): CreditInput {
  return {
    userId,
    currency: 'RUB' as const,
    amount: '100',
    type: 'DEPOSIT',
    idempotencyKey: 'it_' + randomUUID(),
    description: 'integration test',
    ...overrides,
  }
}

async function balanceOf(userId: string): Promise<string> {
  const w = await prisma.walletAccount.findUnique({
    where: { userId_currency: { userId, currency: 'RUB' } },
  })
  return w ? w.balance.toString() : '(no wallet)'
}

afterAll(async () => {
  // LedgerEntry.user FK без cascade — чистим руками; walletAccount уйдёт каскадом от user
  for (const id of createdUserIds) {
    await prisma.ledgerEntry.deleteMany({ where: { userId: id } })
    await prisma.user.delete({ where: { id } }).catch(() => {})
  }
})

dDb('wallet ledger integration (real Postgres)', () => {
  it('credit создаёт кошелёк, проводку и инкрементирует version', async () => {
    const userId = await makeUser()
    const res = await ledger.credit(creditInput(userId, { amount: '150.50' }))
    expect(res.duplicate).toBe(false)
    expect(res.balanceBefore).toBe('0')
    expect(res.balanceAfter).toBe('150.5')
    const w = await prisma.walletAccount.findUnique({
      where: { userId_currency: { userId, currency: 'RUB' } },
    })
    expect(w?.balance.toString()).toBe('150.5')
    expect(w?.version).toBe(1n)
    const entry = await prisma.ledgerEntry.findUnique({ where: { id: res.ledgerEntryId } })
    expect(entry?.type).toBe('DEPOSIT')
    expect(entry?.balanceAfter.toString()).toBe('150.5')
  })

  it('повторный idempotencyKey — duplicate без двойного зачисления', async () => {
    const userId = await makeUser()
    const input = creditInput(userId, { amount: '100' })
    const first = await ledger.credit(input)
    const second = await ledger.credit(input)
    expect(second.duplicate).toBe(true)
    expect(second.ledgerEntryId).toBe(first.ledgerEntryId)
    expect(second.balanceAfter).toBe(first.balanceAfter)
    expect(await prisma.ledgerEntry.count({ where: { userId } })).toBe(1)
  })

  it('debit при недостатке средств — InsufficientFunds, баланс не тронут', async () => {
    const userId = await makeUser()
    await ledger.credit(creditInput(userId, { amount: '50' }))
    await expect(
      ledger.debit(creditInput(userId, { amount: '100', type: 'BET' })),
    ).rejects.toBeInstanceOf(InsufficientFundsError)
    expect(await balanceOf(userId)).toBe('50')
    expect(await prisma.ledgerEntry.count({ where: { userId } })).toBe(1)
  })

  it('P0 #3: сбой ВНУТРИ внешней транзакции откатывает ledger + баланс целиком', async () => {
    const userId = await makeUser()
    await ledger.credit(creditInput(userId, { amount: '100' }))
    await expect(
      txRunner.runInTransaction(async (tx) => {
        await ledger.credit({
          userId,
          currency: 'RUB' as const,
          amount: '500',
          type: 'BONUS',
          idempotencyKey: 'it_' + randomUUID(),
          tx,
        })
        await ledger.debit({
          userId,
          currency: 'RUB' as const,
          amount: '30',
          type: 'BET',
          idempotencyKey: 'it_' + randomUUID(),
          tx,
        })
        throw new Error('boom: имитация краша между операциями')
      }),
    ).rejects.toThrow('boom')
    // ни проводки, ни изменения баланса — всё откатилось вместе
    expect(await balanceOf(userId)).toBe('100')
    const w = await prisma.walletAccount.findUnique({
      where: { userId_currency: { userId, currency: 'RUB' } },
    })
    expect(w?.version).toBe(1n) // откатился и optimistic-lock инкремент
    expect(await prisma.ledgerEntry.count({ where: { userId } })).toBe(1)
  })

  it('P0 #3: bet+win-подобный сценарий в одной транзакции фиксируется атомарно', async () => {
    const userId = await makeUser()
    await ledger.credit(creditInput(userId, { amount: '1000' }))
    const res = await txRunner.runInTransaction(async (tx) => {
      const bet = await ledger.debit({
        userId,
        currency: 'RUB' as const,
        amount: '100',
        type: 'BET',
        idempotencyKey: 'bet_it_' + randomUUID(),
        tx,
      })
      const win = await ledger.credit({
        userId,
        currency: 'RUB' as const,
        amount: '250',
        type: 'WIN',
        idempotencyKey: 'win_it_' + randomUUID(),
        tx,
      })
      return { bet, win }
    })
    expect(res.bet.balanceAfter).toBe('900')
    expect(res.win.balanceAfter).toBe('1150')
    expect(await balanceOf(userId)).toBe('1150')
    // deposit + bet + win
    expect(await prisma.ledgerEntry.count({ where: { userId } })).toBe(3)
  })

  it('P0 #3: дубликат-чек ВНУТРИ tx видит uncommitted записи той же транзакции', async () => {
    const userId = await makeUser()
    const key = 'dup_in_tx_' + randomUUID()
    const res = await txRunner.runInTransaction(async (tx) => {
      const a = await ledger.credit(creditInput(userId, { amount: '10', idempotencyKey: key, tx }))
      // тот же ключ в той же транзакции — duplicate, а не вторая запись
      const b = await ledger.credit(creditInput(userId, { amount: '10', idempotencyKey: key, tx }))
      return { a, b }
    })
    expect(res.b.duplicate).toBe(true)
    expect(await prisma.ledgerEntry.count({ where: { userId, idempotencyKey: key } })).toBe(1)
  })
})
