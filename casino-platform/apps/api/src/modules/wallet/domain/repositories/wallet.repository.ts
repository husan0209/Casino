import type { CreditResult, Currency, MoneyAmount } from '@casino/shared-types'

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
  /** Prisma Prisma.InputJsonValue: Record<string, unknown> не проходит компилятор без приведения. */
  metadata?: Prisma.InputJsonValue
  /**
   * P0 #3: внешний Prisma-клиент транзакции. Если задан — ledger НЕ открывает
   * свой внутренний $transaction (Prisma запрещает вложенные), а проводит
   * мутацию на переданном клиенте: атомарность обеспечивает вызывающий.
   */
  tx?: Prisma.TransactionClient | undefined
}
/** Итог денежной проводки — read-модель в @casino/shared-types (В4); тут
 *  реэкспорт для внутренних потребителей домена/application/facade. */
export type { CreditResult }

export interface IWalletRepository {
  getBalance(userId: string, currency: Currency): Promise<WalletAccount | null>
  listBalances(userId: string): Promise<WalletAccount[]>
}
/**
 * GAP-57: кошелёк, который сериализует денежная транзакция. Ключ advisory-лока
 * строится из этих двух полей (userId+currency) — у одного игрока несколько
 * кошельков (по валютам), и они не должны блокировать друг друга.
 */
export interface WalletLockTarget {
  userId: string
  currency: Currency
}
export const WALLET_REPOSITORY = Symbol('WALLET_REPOSITORY')

/**
 * P0 #3: раннер внешних транзакций. Реализация — в infrastructure (единственное
 * место с правом импорта prisma); application получает tx через колбэк и
 * передаёт его в ledger (CreditInput.tx) и в репозитории других модулей —
 * bet/win/rollback проводятся атомарно одной $transaction.
 *
 * GAP-57: вызывающий ОБЯЗАН указать кошелёк (userId + currency), который
 * мутирует fn. По нему транзакция берёт advisory-лок и сериализует доступ —
 * без этого профиль «много ставок в секунду на одного игрока» откатывался
 * по Serializable (P2034) и 69% ставок доходили до игрока отказом.
 */
export interface IWalletTransactionRunner {
  runInTransaction<T>(
    target: WalletLockTarget,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T>
}
export const WALLET_TRANSACTION_RUNNER = Symbol('WALLET_TRANSACTION_RUNNER')
/** Общие аргументы операций блокировки/выплаты (GAP-25: ≤3 позиционных параметров). */
export interface WithdrawalOpArgs {
  userId: string
  currency: Currency
  amount: MoneyAmount
  idempotencyKey: string
  /**
   * GAP-55 (§11 «статус»): ссылка на payment_request, чтобы проводка
   * заморозки/выплаты была присоединима к заявке. Опционально — существующие
   * вызовы не меняются.
   */
  metadata?: Prisma.InputJsonValue
}
export interface IWalletLedger {
  credit(input: CreditInput): Promise<CreditResult>
  debit(input: CreditInput): Promise<CreditResult>
  lock(args: WithdrawalOpArgs): Promise<CreditResult>
  unlock(args: WithdrawalOpArgs): Promise<CreditResult>
  confirmWithdrawal(args: WithdrawalOpArgs): Promise<CreditResult>
}
export const WALLET_LEDGER = Symbol('WALLET_LEDGER')
