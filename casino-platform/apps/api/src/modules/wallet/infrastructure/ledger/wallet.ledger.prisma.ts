import { randomUUID } from 'crypto'

import { Injectable } from '@nestjs/common'

import { type LedgerEntry, type LedgerEntryType, prisma, type Prisma } from '@casino/database'
import { type Currency, type MoneyAmount, ZERO } from '@casino/shared-types'
import { money } from '@casino/shared-utils'

import { runWalletTransaction } from './wallet-transaction-lock'
import {
  InsufficientFundsError,
  OptimisticLockError,
  UnlockExceedsLockedError,
  WalletNotFoundError,
} from '../../domain/errors'
import {
  type CreditInput,
  type CreditResult,
  type IWalletLedger,
  type IWalletRepository,
  type LedgerEntryAdminRow,
  type LedgerEntryOwnerRow,
  type PaymentStatusById,
  type WalletAccount,
  type WalletLockTarget,
  type WithdrawalOpArgs,
} from '../../domain/repositories/wallet.repository'

/**
 * Architecture (AUDIT_REPORT.md §A1, GAP-22): семантика операций — в
 * application/use-cases (LockFundsUseCase, UnlockFundsUseCase,
 * ConfirmWithdrawalUseCase, WalletFacade — точка входа для других модулей);
 * здесь — только Prisma-реализация атомарных мутаций и retry/idempotency
 * за доменным интерфейсом IWalletLedger. Non-Prisma ledger меняет только этот файл.
 */

/** Prisma возвращает Prisma.Decimal — все денежные значения идут через toString(). */
function toMoney(v: Prisma.Decimal | number | bigint | string): MoneyAmount {
  return v.toString()
}

/**
 * GAP-55 (§11): ссылка на payment_request в метаданных проводки заморозки/
 * разблокировки/выплаты. Без неё строка истории не присоединима к заявке и
 * «статус» показать нечем (join по amount+дате — гадание, не данные).
 */
function withdrawalMetadata(args: WithdrawalOpArgs): Prisma.InputJsonObject {
  const metadata = args.metadata
  if (metadata === undefined || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {}
  }
  return metadata as Prisma.InputJsonObject
}

/**
 * Фильтр списка проводок — ОДИН на оба чтения (админский список и историю
 * игрока). Правило «валюта берётся через кошелёк, у проводки своей колонки
 * валюты нет» иначе лежало бы в двух местах и расходилось бы молча: второй
 * вариант фильтра Prisma не считает ошибкой, он просто отдаёт пустой список.
 */
function entriesWhere(args: {
  userId?: string | undefined
  type?: LedgerEntryType | undefined
  currency?: Currency | undefined
  from?: Date | undefined
  to?: Date | undefined
}): Prisma.LedgerEntryWhereInput {
  const period =
    args.from !== undefined || args.to !== undefined
      ? {
          createdAt: {
            ...(args.from !== undefined && { gte: args.from }),
            ...(args.to !== undefined && { lte: args.to }),
          },
        }
      : {}
  return {
    ...(args.userId !== undefined && { userId: args.userId }),
    ...(args.type !== undefined && { type: args.type }),
    ...(args.currency !== undefined && { walletAccount: { currency: args.currency } }),
    ...period,
  }
}

@Injectable()
export class PrismaWalletRepository implements IWalletRepository {
  async getBalance(userId: string, currency: Currency): Promise<WalletAccount | null> {
    const w = await prisma.walletAccount.findUnique({
      where: { userId_currency: { userId, currency } },
    })
    if (!w) {
      return null
    }
    return {
      userId: w.userId,
      currency: w.currency as Currency,
      balance: toMoney(w.balance),
      locked: toMoney(w.locked),
      version: w.version,
    }
  }
  async listBalances(userId: string): Promise<WalletAccount[]> {
    const rows = await prisma.walletAccount.findMany({ where: { userId } })
    return rows.map((w) => ({
      userId: w.userId,
      currency: w.currency as Currency,
      balance: toMoney(w.balance),
      locked: toMoney(w.locked),
      version: w.version,
    }))
  }
  /**
   * Админский список проводок (UC-PAY-16). Фильтр по валюте — через кошелёк,
   * потому что у самой проводки валюты нет: она принадлежит `wallet_account`.
   */
  listEntries(args: {
    userId?: string | undefined
    type?: LedgerEntryType | undefined
    currency?: Currency | undefined
    page: number
    perPage: number
  }): Promise<[LedgerEntryAdminRow[], number]> {
    const where = entriesWhere(args)
    return Promise.all([
      prisma.ledgerEntry.findMany({
        where,
        skip: (args.page - 1) * args.perPage,
        take: args.perPage,
        orderBy: { createdAt: 'desc' },
        include: {
          walletAccount: { select: { currency: true } },
          user: { select: { email: true } },
        },
      }),
      prisma.ledgerEntry.count({ where }),
    ])
  }

  /**
   * История проводок игрока (GAP-55 §11, `GET /wallet/transactions`).
   *
   * От админского списка отличается составом `include`: здесь не нужен email
   * игрока — он и есть тот, кто запросил, и джойнить `users` на каждую страницу
   * истории незачем.
   */
  listOwnerEntries(args: {
    userId: string
    type?: LedgerEntryType | undefined
    currency?: Currency | undefined
    from?: Date | undefined
    to?: Date | undefined
    page: number
    perPage: number
  }): Promise<[LedgerEntryOwnerRow[], number]> {
    const where = entriesWhere(args)
    return Promise.all([
      prisma.ledgerEntry.findMany({
        where,
        skip: (args.page - 1) * args.perPage,
        take: args.perPage,
        orderBy: { createdAt: 'desc' },
        include: { walletAccount: { select: { currency: true } } },
      }),
      prisma.ledgerEntry.count({ where }),
    ])
  }

  findEntriesForPayment(paymentRequestId: string): Promise<LedgerEntry[]> {
    return prisma.ledgerEntry.findMany({
      where: { metadata: { path: ['payment_request_id'], equals: paymentRequestId } },
    })
  }

  findPaymentStatuses(userId: string, ids: string[]): Promise<PaymentStatusById[]> {
    return prisma.paymentRequest.findMany({
      where: { userId, id: { in: ids } },
      select: { id: true, status: true },
    })
  }
}

@Injectable()
export class PrismaWalletLedger implements IWalletLedger {
  private async runCreditDebit(input: CreditInput, sign: 1 | -1): Promise<CreditResult> {
    // idempotency check (читаем на том же клиенте, что и мутация —
    // внутри внешней транзакции это условие гонки внутри tx и корректно)
    const client: Prisma.TransactionClient = input.tx ?? prisma
    const existing = await client.ledgerEntry.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    })
    if (existing) {
      return {
        balanceBefore: toMoney(existing.balanceBefore),
        balanceAfter: toMoney(existing.balanceAfter),
        ledgerEntryId: existing.id,
        duplicate: true,
      }
    }
    // P0 #3: внутри внешней транзакции свой $transaction открыть нельзя
    // (Prisma запрещает вложенные) — мутация идёт на переданном клиенте;
    // атомарность и сериализацию по кошельку обеспечивает запустивший транзакцию.
    if (input.tx) {
      return this.applyCreditDebit(input.tx, input, sign)
    }
    // GAP-57: solo-путь (депозит/реферальная выплата/admin) идёт через ту же
    // примитиву, что и bet/win — advisory-лок + ReadCommitted + повтор.
    return runWalletTransaction({ userId: input.userId, currency: input.currency }, (tx) =>
      this.applyCreditDebit(tx, input, sign),
    )
  }

  /** Гет-ор-крейт кошелька — общий для credit/debit; разбивка runCreditDebit (GAP-22). */
  private async getOrCreateWallet(
    tx: Prisma.TransactionClient,
    userId: string,
    currency: Currency,
  ): Promise<{
    id: string
    createdAt: Date
    updatedAt: Date
    userId: string
    currency: string
    balance: Prisma.Decimal
    locked: Prisma.Decimal
    version: bigint
  }> {
    const wallet = await tx.walletAccount.findUnique({
      where: { userId_currency: { userId, currency } },
    })
    if (wallet) {
      return wallet
    }
    return tx.walletAccount.create({
      data: {
        userId,
        currency,
        balance: ZERO[currency],
        locked: ZERO[currency],
        version: 0n,
      },
    })
  }

  /** Тело мутации без обёртки $transaction — общий для tx-режима и solo-режима. */
  private async applyCreditDebit(
    tx: Prisma.TransactionClient,
    input: CreditInput,
    sign: 1 | -1,
  ): Promise<CreditResult> {
    const wallet = await this.getOrCreateWallet(tx, input.userId, input.currency)
    const balanceBefore = toMoney(wallet.balance)
    const available = money.subtract(balanceBefore, toMoney(wallet.locked))
    if (sign === -1 && !money.isGreaterOrEqual(available, input.amount)) {
      throw new InsufficientFundsError(input.amount, available)
    }
    const balanceAfter =
      sign === 1
        ? money.add(balanceBefore, input.amount)
        : money.subtract(balanceBefore, input.amount)
    const updated = await tx.walletAccount.updateMany({
      where: { userId: input.userId, currency: input.currency, version: wallet.version },
      data: { balance: balanceAfter, version: { increment: 1 } },
    })
    if (updated.count === 0) {
      throw new OptimisticLockError()
    }
    const ledger = await tx.ledgerEntry.create({
      data: {
        transactionId: randomUUID(),
        walletAccountId: wallet.id,
        userId: input.userId,
        type: input.type,
        amount: sign === 1 ? input.amount : '-' + input.amount,
        balanceBefore,
        balanceAfter,
        idempotencyKey: input.idempotencyKey,
        description: input.description ?? null,
        metadata: input.metadata ?? {},
      },
    })
    return { balanceBefore, balanceAfter, ledgerEntryId: ledger.id, duplicate: false }
  }

  credit(input: CreditInput): Promise<CreditResult> {
    return this.runCreditDebit(input, 1)
  }
  debit(input: CreditInput): Promise<CreditResult> {
    return this.runCreditDebit(input, -1)
  }

  /** Дубликат-чек по idempotencyKey — общий для lock/unlock/confirmWithdrawal (GAP-30). */
  private async existingDuplicate(idempotencyKey: string): Promise<CreditResult | null> {
    const existing = await prisma.ledgerEntry.findUnique({ where: { idempotencyKey } })
    if (!existing) {
      return null
    }
    return {
      balanceBefore: toMoney(existing.balanceBefore),
      balanceAfter: toMoney(existing.balanceAfter),
      ledgerEntryId: existing.id,
      duplicate: true,
    }
  }

  /**
   * GAP-57: транзакция блокировки/разблокировки/выплаты — advisory-лок на
   * кошелёк + ReadCommitted + повтор при конфликте (общая примитива).
   * Мутируется ровно один кошелёк, поэтому ключ лока однозначен.
   */
  private withRetry(
    args: WalletLockTarget,
    txBody: (tx: Prisma.TransactionClient) => Promise<CreditResult>,
  ): Promise<CreditResult> {
    return runWalletTransaction(args, txBody)
  }

  private async findWalletOrThrow(
    tx: Prisma.TransactionClient,
    userId: string,
    currency: Currency,
  ): Promise<{
    id: string
    createdAt: Date
    updatedAt: Date
    userId: string
    currency: string
    balance: Prisma.Decimal
    locked: Prisma.Decimal
    version: bigint
  }> {
    const wallet = await tx.walletAccount.findUnique({
      where: { userId_currency: { userId, currency } },
    })
    if (!wallet) {
      throw new WalletNotFoundError(userId, currency)
    }
    return wallet
  }

  private async ledgerEntry(
    tx: Prisma.TransactionClient,
    data: {
      walletAccountId: string
      userId: string
      type: 'WITHDRAWAL_LOCK' | 'WITHDRAWAL_UNLOCK' | 'WITHDRAWAL_CONFIRM'
      amount: string
      balanceBefore: MoneyAmount
      balanceAfter: MoneyAmount
      idempotencyKey: string
      description: string
      metadata?: Prisma.InputJsonValue
    },
  ): Promise<{
    id: string
    createdAt: Date
    transactionId: string
    walletAccountId: string
    type: LedgerEntryType
    amount: Prisma.Decimal
    balanceBefore: Prisma.Decimal
    balanceAfter: Prisma.Decimal
    idempotencyKey: string | null
    description: string | null
    metadata: Prisma.JsonValue
    userId: string | null
  }> {
    return tx.ledgerEntry.create({
      data: { transactionId: randomUUID(), ...data, metadata: data.metadata ?? {} },
    })
  }

  async lock(args: WithdrawalOpArgs): Promise<CreditResult> {
    const { userId, currency, amount, idempotencyKey } = args
    const duplicate = await this.existingDuplicate(idempotencyKey)
    if (duplicate) {
      return duplicate
    }
    return this.withRetry({ userId, currency }, async (tx) => {
      const wallet = await this.findWalletOrThrow(tx, userId, currency)
      const balance = toMoney(wallet.balance)
      const currentLocked = toMoney(wallet.locked)
      const available = money.subtract(balance, currentLocked)
      if (!money.isGreaterOrEqual(available, amount)) {
        throw new InsufficientFundsError(amount, available)
      }
      const updated = await tx.walletAccount.updateMany({
        where: { id: wallet.id, version: wallet.version },
        data: { locked: money.add(currentLocked, amount), version: { increment: 1 } },
      })
      if (updated.count === 0) {
        throw new OptimisticLockError()
      }
      const ledger = await this.ledgerEntry(tx, {
        walletAccountId: wallet.id,
        userId,
        type: 'WITHDRAWAL_LOCK',
        amount: '0',
        balanceBefore: balance,
        balanceAfter: balance,
        idempotencyKey,
        description: 'Withdrawal lock',
        metadata: { locked_amount: amount, ...withdrawalMetadata(args) },
      })
      return {
        balanceBefore: balance,
        balanceAfter: balance,
        ledgerEntryId: ledger.id,
        duplicate: false,
      }
    })
  }

  async unlock(args: WithdrawalOpArgs): Promise<CreditResult> {
    const { userId, currency, amount, idempotencyKey } = args
    const duplicate = await this.existingDuplicate(idempotencyKey)
    if (duplicate) {
      return duplicate
    }
    return this.withRetry({ userId, currency }, async (tx) => {
      const wallet = await this.findWalletOrThrow(tx, userId, currency)
      const currentLocked = toMoney(wallet.locked)
      // Prevent negative locked balance. If unlock amount > currently locked,
      // this is either a logic bug or an attack — abort the transaction.
      if (!money.isGreaterOrEqual(currentLocked, amount)) {
        throw new UnlockExceedsLockedError()
      }
      const updated = await tx.walletAccount.updateMany({
        where: { id: wallet.id, version: wallet.version },
        data: { locked: money.subtract(currentLocked, amount), version: { increment: 1 } },
      })
      if (updated.count === 0) {
        throw new OptimisticLockError()
      }
      const balance = toMoney(wallet.balance)
      const ledger = await this.ledgerEntry(tx, {
        walletAccountId: wallet.id,
        userId,
        type: 'WITHDRAWAL_UNLOCK',
        amount: '0',
        balanceBefore: balance,
        balanceAfter: balance,
        idempotencyKey,
        description: 'Withdrawal unlock',
        metadata: { unlocked_amount: amount, ...withdrawalMetadata(args) },
      })
      return {
        balanceBefore: balance,
        balanceAfter: balance,
        ledgerEntryId: ledger.id,
        duplicate: false,
      }
    })
  }

  async confirmWithdrawal(args: WithdrawalOpArgs): Promise<CreditResult> {
    const { userId, currency, amount, idempotencyKey } = args
    // debit + unlock atomically
    const duplicate = await this.existingDuplicate(idempotencyKey)
    if (duplicate) {
      return duplicate
    }
    return this.withRetry({ userId, currency }, async (tx) => {
      const wallet = await this.findWalletOrThrow(tx, userId, currency)
      const balanceBefore = toMoney(wallet.balance)
      const currentLocked = toMoney(wallet.locked)
      if (!money.isGreaterOrEqual(balanceBefore, amount)) {
        throw new InsufficientFundsError(amount, balanceBefore)
      }
      if (!money.isGreaterOrEqual(currentLocked, amount)) {
        throw new UnlockExceedsLockedError()
      }
      const balanceAfter = money.subtract(balanceBefore, amount)
      const updated = await tx.walletAccount.updateMany({
        where: { id: wallet.id, version: wallet.version },
        data: {
          balance: balanceAfter,
          locked: money.subtract(currentLocked, amount),
          version: { increment: 1 },
        },
      })
      if (updated.count === 0) {
        throw new OptimisticLockError()
      }
      const ledger = await this.ledgerEntry(tx, {
        walletAccountId: wallet.id,
        userId,
        type: 'WITHDRAWAL_CONFIRM',
        amount: '-' + amount,
        balanceBefore,
        balanceAfter,
        idempotencyKey,
        description: 'Withdrawal confirmed',
        metadata: withdrawalMetadata(args),
      })
      return { balanceBefore, balanceAfter, ledgerEntryId: ledger.id, duplicate: false }
    })
  }
}
