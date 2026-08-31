import type { Currency, MoneyAmount } from '@casino/shared-types'

import type { LedgerEntryType, Prisma } from '@prisma/client'

export interface WalletAccount {
  userId: string
  currency: Currency
  balance: MoneyAmount
  locked: MoneyAmount
  version: bigint
}
export interface CreditInput {
  userId: string
  currency: Currency
  amount: MoneyAmount
  /** Тип проводки — enum БД; литералы вызывающих проверяются компилятором. */
  type: LedgerEntryType
  idempotencyKey: string
  description?: string
  /** Prisma InputJsonValue: Record<string, unknown> не проходит компилятор без приведения. */
  metadata?: Prisma.InputJsonValue
  /**
   * P0 #3: внешний Prisma-клиент транзакции. Если задан — ledger НЕ открывает
   * свой внутренний $transaction (Prisma запрещает вложенные), а проводит
   * мутацию на переданном клиенте: атомарность обеспечивает вызывающий.
   */
  tx?: Prisma.TransactionClient | undefined
}
export interface CreditResult {
  balanceBefore: MoneyAmount
  balanceAfter: MoneyAmount
  ledgerEntryId: string
  duplicate: boolean
}
export interface IWalletRepository {
  getBalance(userId: string, currency: Currency): Promise<WalletAccount | null>
  listBalances(userId: string): Promise<WalletAccount[]>
}
export const WALLET_REPOSITORY = Symbol('WALLET_REPOSITORY')

/**
 * P0 #3: раннер внешних транзакций. Реализация — в infrastructure (единственное
 * место с правом импорта prisma); application получает tx через колбэк и
 * передаёт его в ledger (CreditInput.tx) и в репозитории других модулей —
 * bet/win/rollback проводятся атомарно одной $transaction.
 */
export interface IWalletTransactionRunner {
  runInTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>
}
export const WALLET_TRANSACTION_RUNNER = Symbol('WALLET_TRANSACTION_RUNNER')
export interface IWalletLedger {
  credit(input: CreditInput): Promise<CreditResult>
  debit(input: CreditInput): Promise<CreditResult>
  lock(
    userId: string,
    currency: Currency,
    amount: MoneyAmount,
    idempotencyKey: string,
  ): Promise<CreditResult>
  unlock(
    userId: string,
    currency: Currency,
    amount: MoneyAmount,
    idempotencyKey: string,
  ): Promise<CreditResult>
  confirmWithdrawal(
    userId: string,
    currency: Currency,
    amount: MoneyAmount,
    idempotencyKey: string,
  ): Promise<CreditResult>
}
export const WALLET_LEDGER = Symbol('WALLET_LEDGER')
