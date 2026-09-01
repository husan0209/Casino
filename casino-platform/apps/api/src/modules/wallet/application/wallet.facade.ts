import { Inject, Injectable } from '@nestjs/common'

import type { Currency, MoneyAmount } from '@casino/shared-types'
import { money } from '@casino/shared-utils'


import { ConfirmWithdrawalUseCase } from './use-cases/confirm-withdrawal.use-case'
import { LockFundsUseCase } from './use-cases/lock-funds.use-case'
import { UnlockFundsUseCase } from './use-cases/unlock-funds.use-case'
import {
  IWalletLedger,
  IWalletRepository,
  IWalletTransactionRunner,
  WALLET_LEDGER,
  WALLET_REPOSITORY,
  WALLET_TRANSACTION_RUNNER,
  type CreditInput,
  type CreditResult,
} from '../domain/repositories/wallet.repository'

import type { Prisma } from '@prisma/client'

/**
 * Единственная точка входа в wallet для других модулей (4-слойка, GAP-22):
 * семантика операций — в application/use-cases, Prisma-реализация —
 * в infrastructure за доменными интерфейсами.
 */
@Injectable()
export class WalletFacade {
  constructor(
    @Inject(WALLET_LEDGER) private ledger: IWalletLedger,
    @Inject(WALLET_REPOSITORY) private repo: IWalletRepository,
    @Inject(WALLET_TRANSACTION_RUNNER) private txRunner: IWalletTransactionRunner,
    private lockFunds: LockFundsUseCase,
    private unlockFunds: UnlockFundsUseCase,
    private confirmWithdrawalUc: ConfirmWithdrawalUseCase,
  ) {}
  /**
   * P0 #3: атомарный денежный сценарий. Колбэк получает Prisma tx — передавайте
   * его в credit/debit (CreditInput.tx) и в репозитории игровых транзакций,
   * чтобы ledger-запись и gameTransaction коммитились одним $transaction.
   */
  runInTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.txRunner.runInTransaction(fn)
  }
  credit(input: CreditInput) {
    return this.ledger.credit(input)
  }
  debit(input: CreditInput) {
    return this.ledger.debit(input)
  }
  lock(userId: string, currency: Currency, amount: MoneyAmount, key: string): Promise<CreditResult> {
    return this.lockFunds.execute({ userId, currency, amount, idempotencyKey: key })
  }
  unlock(
    userId: string,
    currency: Currency,
    amount: MoneyAmount,
    key: string,
  ): Promise<CreditResult> {
    return this.unlockFunds.execute({ userId, currency, amount, idempotencyKey: key })
  }
  confirmWithdrawal(
    userId: string,
    currency: Currency,
    amount: MoneyAmount,
    key: string,
  ): Promise<CreditResult> {
    return this.confirmWithdrawalUc.execute({ userId, currency, amount, idempotencyKey: key })
  }
  getBalances(userId: string) {
    return this.repo.listBalances(userId)
  }
  async getBalance(userId: string, currency: Currency) {
    const w = await this.repo.getBalance(userId, currency)
    if (!w) {
      return { currency, balance: '0', locked: '0', available: '0' }
    }
    return {
      currency,
      balance: w.balance,
      locked: w.locked,
      available: money.subtract(w.balance, w.locked),
    }
  }
}
