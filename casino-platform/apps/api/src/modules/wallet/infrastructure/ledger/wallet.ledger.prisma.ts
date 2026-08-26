import { Injectable } from '@nestjs/common'
import { prisma } from '@casino/database'
import { ZERO, type Currency, type MoneyAmount } from '@casino/shared-types'
import { money } from '@casino/shared-utils'
import { IWalletRepository, IWalletLedger, type CreditInput, type CreditResult, type WalletAccount } from '../../domain/repositories/wallet.repository'
import { InsufficientFundsError, OptimisticLockError } from '../../domain/errors'

/**
 * NOTE on architecture (AUDIT_REPORT.md §A1):
 * The 4-layer rule says ledger operations should live in application/use-cases/.
 * We keep them here as an internal Prisma-backed implementation of IWalletLedger
 * (a domain interface) and expose them only through WalletFacade. This is a
 * pragmatic compromise: the IWalletLedger boundary is enforced, but the actual
 * use-case class wrappers would be redundant boilerplate. When a non-Prisma
 * ledger is added, only this file needs to change.
 */


function toMoney(n: any): MoneyAmount { return n.toString() }

@Injectable()
export class PrismaWalletRepository implements IWalletRepository {
  async getBalance(userId: string, currency: Currency): Promise<WalletAccount | null> {
    const w = await prisma.walletAccount.findUnique({ where: { userId_currency: { userId, currency } }})
    if (!w) return null
    return { userId: w.userId, currency: w.currency as Currency, balance: toMoney(w.balance), locked: toMoney(w.locked), version: w.version }
  }
  async listBalances(userId: string): Promise<WalletAccount[]> {
    const rows = await prisma.walletAccount.findMany({ where: { userId }})
    return rows.map((w: { userId: string; currency: string; balance: any; locked: any; version: bigint }) => ({ userId: w.userId, currency: w.currency as Currency, balance: toMoney(w.balance), locked: toMoney(w.locked), version: w.version }))
  }
}

@Injectable()
export class PrismaWalletLedger implements IWalletLedger {
  private async runCreditDebit(input: CreditInput, sign: 1|-1): Promise<CreditResult> {
    // idempotency check
    const existing = await prisma.ledgerEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey }})
    if (existing) {
      return { balanceBefore: toMoney(existing.balanceBefore), balanceAfter: toMoney(existing.balanceAfter), ledgerEntryId: existing.id, duplicate: true }
    }
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return await prisma.$transaction(async (tx: { [k: string]: any }) => {
          let wallet = await tx.walletAccount.findUnique({ where: { userId_currency: { userId: input.userId, currency: input.currency }}})
          if (!wallet) {
            wallet = await tx.walletAccount.create({ data: { userId: input.userId, currency: input.currency, balance: ZERO[input.currency], locked: ZERO[input.currency], version: 0n }})
          }
          const balanceBefore = toMoney(wallet.balance)
          const available = money.subtract(balanceBefore, toMoney(wallet.locked))
          if (sign === -1 && !money.isGreaterOrEqual(available, input.amount)) {
            throw new InsufficientFundsError(input.amount, available)
          }
          const balanceAfter = sign === 1 ? money.add(balanceBefore, input.amount) : money.subtract(balanceBefore, input.amount)
          const updated = await tx.walletAccount.updateMany({
            where: { userId: input.userId, currency: input.currency, version: wallet.version },
            data: { balance: balanceAfter, version: { increment: 1 } }
          })
          if (updated.count === 0) throw new OptimisticLockError()
          const ledger = await tx.ledgerEntry.create({
            data: {
              transactionId: randomUUID(),
              walletAccountId: wallet.id,
              userId: input.userId,
              type: input.type as any,
              amount: sign === 1 ? input.amount : '-' + input.amount,
              balanceBefore,
              balanceAfter,
              idempotencyKey: input.idempotencyKey,
              description: input.description,
              metadata: input.metadata ?? {}
            }
          })
          return { balanceBefore, balanceAfter, ledgerEntryId: ledger.id, duplicate: false }
        }, { isolationLevel: 'Serializable' })
      } catch (e) {
        if (e instanceof OptimisticLockError && attempt < 3) {
          await new Promise(r => setTimeout(r, 50 * attempt * attempt))
          continue
        }
        throw e
      }
    }
    throw new OptimisticLockError()
  }

  credit(input: CreditInput): Promise<CreditResult> { return this.runCreditDebit(input, 1) }
  debit(input: CreditInput): Promise<CreditResult> { return this.runCreditDebit(input, -1) }

  async lock(userId: string, currency: Currency, amount: MoneyAmount, idempotencyKey: string): Promise<CreditResult> {
    const existing = await prisma.ledgerEntry.findUnique({ where: { idempotencyKey }})
    if (existing) return { balanceBefore: toMoney(existing.balanceBefore), balanceAfter: toMoney(existing.balanceAfter), ledgerEntryId: existing.id, duplicate: true }
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return await prisma.$transaction(async (tx: { [k: string]: any }) => {
          const wallet = await tx.walletAccount.findUnique({ where: { userId_currency: { userId, currency }}})
          if (!wallet) throw new Error('WALLET_NOT_FOUND')
          const balance = toMoney(wallet.balance)
          const currentLocked = toMoney(wallet.locked)
          const available = money.subtract(balance, currentLocked)
          if (!money.isGreaterOrEqual(available, amount)) throw new InsufficientFundsError(amount, available)
          const newLocked = money.add(currentLocked, amount)
          const updated = await tx.walletAccount.updateMany({
            where: { id: wallet.id, version: wallet.version },
            data: { locked: newLocked, version: { increment: 1 } },
          })
          if (updated.count === 0) throw new OptimisticLockError()
          const ledger = await tx.ledgerEntry.create({
            data: {
              transactionId: randomUUID(), walletAccountId: wallet.id, userId,
              type: 'WITHDRAWAL_LOCK', amount: '0',
              balanceBefore: balance, balanceAfter: balance,
              idempotencyKey, description: 'Withdrawal lock', metadata: { locked_amount: amount }
            }
          })
          return { balanceBefore: balance, balanceAfter: balance, ledgerEntryId: ledger.id, duplicate: false }
        }, { isolationLevel: 'Serializable' })
      } catch (e) {
        // Don't retry on business errors (InsufficientFundsError) — they won't get better.
        if (e instanceof InsufficientFundsError) throw e
        if (e instanceof OptimisticLockError && attempt < 3) {
          await new Promise(r => setTimeout(r, 50 * attempt * attempt))
          continue
        }
        throw e
      }
    }
    throw new OptimisticLockError()
  }

  async unlock(userId: string, currency: Currency, amount: MoneyAmount, idempotencyKey: string): Promise<CreditResult> {
    const existing = await prisma.ledgerEntry.findUnique({ where: { idempotencyKey }})
    if (existing) return { balanceBefore: toMoney(existing.balanceBefore), balanceAfter: toMoney(existing.balanceAfter), ledgerEntryId: existing.id, duplicate: true }
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return await prisma.$transaction(async (tx: { [k: string]: any }) => {
          const wallet = await tx.walletAccount.findUnique({ where: { userId_currency: { userId, currency }}})
          if (!wallet) throw new Error('WALLET_NOT_FOUND')
          const currentLocked = toMoney(wallet.locked)
          const newLocked = money.subtract(currentLocked, amount)
          // Prevent negative locked balance. If unlock amount > currently locked,
          // this is either a logic bug or an attack — abort the transaction.
          if (!money.isGreaterOrEqual(currentLocked, amount)) {
            throw new Error('UNLOCK_EXCEEDS_LOCKED')
          }
          const updated = await tx.walletAccount.updateMany({
            where: { id: wallet.id, version: wallet.version },
            data: { locked: newLocked, version: { increment: 1 } },
          })
          if (updated.count === 0) throw new OptimisticLockError()
          const ledger = await tx.ledgerEntry.create({
            data: { transactionId: randomUUID(), walletAccountId: wallet.id, userId,
              type: 'WITHDRAWAL_UNLOCK', amount: '0',
              balanceBefore: toMoney(wallet.balance), balanceAfter: toMoney(wallet.balance),
              idempotencyKey, description: 'Withdrawal unlock', metadata: { unlocked_amount: amount }}
          })
          return { balanceBefore: toMoney(wallet.balance), balanceAfter: toMoney(wallet.balance), ledgerEntryId: ledger.id, duplicate: false }
        }, { isolationLevel: 'Serializable' })
      } catch (e) {
        // Don't retry on business errors (UNLOCK_EXCEEDS_LOCKED) — they won't get better.
        if (e instanceof Error && e.message === 'UNLOCK_EXCEEDS_LOCKED') throw e
        if (e instanceof OptimisticLockError && attempt < 3) {
          await new Promise(r => setTimeout(r, 50 * attempt * attempt))
          continue
        }
        throw e
      }
    }
    throw new OptimisticLockError()
  }

  async confirmWithdrawal(userId: string, currency: Currency, amount: MoneyAmount, idempotencyKey: string): Promise<CreditResult> {
    // debit + unlock atomically
    const existing = await prisma.ledgerEntry.findUnique({ where: { idempotencyKey }})
    if (existing) return { balanceBefore: toMoney(existing.balanceBefore), balanceAfter: toMoney(existing.balanceAfter), ledgerEntryId: existing.id, duplicate: true }
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return await prisma.$transaction(async (tx: { [k: string]: any }) => {
          const wallet = await tx.walletAccount.findUnique({ where: { userId_currency: { userId, currency }}})
          if (!wallet) throw new Error('WALLET_NOT_FOUND')
          const balanceBefore = toMoney(wallet.balance)
          const balanceAfter = money.subtract(balanceBefore, amount)
          const newLocked = money.subtract(toMoney(wallet.locked), amount)
          const updated = await tx.walletAccount.updateMany({
            where: { id: wallet.id, version: wallet.version },
            data: { balance: balanceAfter, locked: newLocked, version: { increment: 1 } }
          })
          if (updated.count === 0) throw new OptimisticLockError()
          const ledger = await tx.ledgerEntry.create({ data: {
            transactionId: randomUUID(), walletAccountId: wallet.id, userId,
            type: 'WITHDRAWAL_CONFIRM', amount: '-' + amount,
            balanceBefore, balanceAfter, idempotencyKey, description: 'Withdrawal confirmed'
          }})
          return { balanceBefore, balanceAfter, ledgerEntryId: ledger.id, duplicate: false }
        }, { isolationLevel: 'Serializable' })
      } catch (e) {
        if (e instanceof OptimisticLockError && attempt < 3) { await new Promise(r=>setTimeout(r, 50*attempt*attempt)); continue }
        throw e
      }
    }
    throw new OptimisticLockError()
  }
}

function randomUUID(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('crypto').randomUUID() as string
}
