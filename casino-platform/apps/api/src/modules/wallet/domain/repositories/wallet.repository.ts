import type { MoneyAmount, Currency } from '@casino/shared-types'
export interface WalletAccount { userId: string; currency: Currency; balance: MoneyAmount; locked: MoneyAmount; version: bigint }
export interface CreditInput {
  userId: string; currency: Currency; amount: MoneyAmount;
  type: string; idempotencyKey: string; description?: string; metadata?: any;
}
export interface CreditResult { balanceBefore: MoneyAmount; balanceAfter: MoneyAmount; ledgerEntryId: string; duplicate: boolean }
export interface IWalletRepository {
  getBalance(userId: string, currency: Currency): Promise<WalletAccount | null>
  listBalances(userId: string): Promise<WalletAccount[]>
}
export const WALLET_REPOSITORY = Symbol('WALLET_REPOSITORY')
export interface IWalletLedger {
  credit(input: CreditInput): Promise<CreditResult>
  debit(input: CreditInput): Promise<CreditResult>
  lock(userId: string, currency: Currency, amount: MoneyAmount, idempotencyKey: string): Promise<CreditResult>
  unlock(userId: string, currency: Currency, amount: MoneyAmount, idempotencyKey: string): Promise<CreditResult>
  confirmWithdrawal(userId: string, currency: Currency, amount: MoneyAmount, idempotencyKey: string): Promise<CreditResult>
}
export const WALLET_LEDGER = Symbol('WALLET_LEDGER')
