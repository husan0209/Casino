import { Inject, Injectable } from '@nestjs/common'

import type { Currency } from '@casino/shared-types'
import { money } from '@casino/shared-utils'

import {
  ConfirmWithdrawalUseCase,
  type ConfirmWithdrawalInput,
} from '../application/use-cases/confirm-withdrawal.use-case'
import { LockFundsUseCase, type LockFundsInput } from '../application/use-cases/lock-funds.use-case'
import {
  UnlockFundsUseCase,
  type UnlockFundsInput,
} from '../application/use-cases/unlock-funds.use-case'
import {
  type IWalletLedger,
  type IWalletRepository,
  type IWalletTransactionRunner,
  WALLET_LEDGER,
  WALLET_REPOSITORY,
  WALLET_TRANSACTION_RUNNER,
  type CreditInput,
  type CreditResult,
  type LedgerEntryAdminRow,
  type WalletLockTarget,
} from '../domain/repositories/wallet.repository'

import type { LedgerEntry, LedgerEntryType, Prisma } from '@prisma/client'

/**
 * Read-модель админского списка проводок отдаётся через фасад (правило 4, G16):
 * потребителю незачем импортировать domain-слой wallet, чтобы назвать тип
 * собственного ответа.
 */
export type { LedgerEntryAdminRow } from '../domain/repositories/wallet.repository'

/**
 * Единственная точка входа в wallet для других модулей (4-слойка, GAP-22):
 * семантика операций — в application/use-cases, Prisma-реализация —
 * в infrastructure за доменными интерфейсами.
 */
/** Строка баланса кошелька (структурно = WalletAccount из репозитория). */
export type WalletBalanceRow = {
  currency: string
  balance: string
  locked: string
  version: bigint
}

/** Текущий баланс для одной валюты (RUB-отображение). */
export type WalletBalanceView = {
  currency: string
  balance: string
  locked: string
  available: string
}

@Injectable()
export class WalletFacade {
  constructor(
    @Inject(WALLET_LEDGER) private ledger: IWalletLedger,
    @Inject(WALLET_REPOSITORY) private repo: IWalletRepository,
    @Inject(WALLET_TRANSACTION_RUNNER) private txRunner: IWalletTransactionRunner,
    @Inject(LockFundsUseCase) private lockFunds: LockFundsUseCase,
    @Inject(UnlockFundsUseCase) private unlockFunds: UnlockFundsUseCase,
    @Inject(ConfirmWithdrawalUseCase) private confirmWithdrawalUc: ConfirmWithdrawalUseCase,
  ) {}
  /**
   * P0 #3: атомарный денежный сценарий. Колбэк получает Prisma tx — передавайте
   * его в credit/debit (CreditInput.tx) и в репозитории игровых транзакций,
   * чтобы ledger-запись и gameTransaction коммитились одним $transaction.
   *
   * GAP-57: `target` — кошелёк, который мутирует fn. По нему транзакция берёт
   * advisory-лок (очередь вместо abort-волн при конкурентных ставках).
   */
  runInTransaction<T>(
    target: WalletLockTarget,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.txRunner.runInTransaction(target, fn)
  }
  credit(input: CreditInput): Promise<CreditResult> {
    return this.ledger.credit(input)
  }
  debit(input: CreditInput): Promise<CreditResult> {
    return this.ledger.debit(input)
  }
  lock(args: LockFundsInput): Promise<CreditResult> {
    return this.lockFunds.execute(args)
  }
  unlock(args: UnlockFundsInput): Promise<CreditResult> {
    return this.unlockFunds.execute(args)
  }
  confirmWithdrawal(args: ConfirmWithdrawalInput): Promise<CreditResult> {
    return this.confirmWithdrawalUc.execute(args)
  }
  getBalances(userId: string): Promise<WalletBalanceRow[]> {
    return this.repo.listBalances(userId)
  }
  async getBalance(userId: string, currency: Currency): Promise<WalletBalanceView> {
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

  /**
   * Список журнала для админки (ТЗ ч.3 UC-PAY-16) и проводки одной заявки
   * (UC-PAY-18). Чтение `ledger_entries` отдаёт его владелец — wallet; до
   * храповика G27 запрос собирал `admin-finance.controller.ts` напрямую.
   */
  listLedgerEntries(args: {
    userId?: string | undefined
    type?: LedgerEntryType | undefined
    currency?: Currency | undefined
    page: number
    perPage: number
  }): Promise<{ items: LedgerEntryAdminRow[]; total: number }> {
    return this.repo.listEntries(args).then(([items, total]) => ({ items, total }))
  }

  listEntriesForPaymentRequest(paymentRequestId: string): Promise<LedgerEntry[]> {
    return this.repo.findEntriesForPayment(paymentRequestId)
  }
}
