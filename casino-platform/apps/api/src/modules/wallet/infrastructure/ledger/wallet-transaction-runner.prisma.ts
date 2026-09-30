import { Injectable } from '@nestjs/common'

import { runWalletTransaction } from './wallet-transaction-lock'
import { type IWalletTransactionRunner, type WalletLockTarget } from '../../domain/repositories/wallet.repository'

/**
 * P0 #3: единственная точка открытия внешних денежных транзакций.
 *
 * GAP-57: транзакция сериализуется advisory-локом на кошелёк и работает на
 * ReadCommitted — реализация в runWalletTransaction (общая примитива с ledger'ом,
 * чтобы оба пути «деньги» вели себя одинаково). Здесь — только адаптер под
 * доменный интерфейс: вызывающий передаёт кошелёк, который транзакция мутирует.
 *
 * Контракт для вызывающего: указать userId+currency, которые меняет fn, и
 * передать fn тот же tx в credit/debit (CreditInput.tx) и репозитории
 * игровых транзакций — тогда ledger-запись и gameTransaction коммитятся одной
 * транзакцией.
 */
@Injectable()
export class PrismaWalletTransactionRunner implements IWalletTransactionRunner {
  runInTransaction<T>(target: WalletLockTarget, fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
    return runWalletTransaction(target, fn)
  }
}

type TransactionClient = Parameters<Parameters<typeof runWalletTransaction>[1]>[0]
