import type { CreditResult, Currency, MoneyAmount } from '@casino/shared-types'

import type { LedgerEntry, LedgerEntryType, PaymentStatus, Prisma } from '@prisma/client'

/** id + статус заявки — минимальный набор для строки истории проводок. */
export type PaymentStatusById = { id: string; status: PaymentStatus }

/**
 * Строка журнала для админского списка: проводка + валюта кошелька + email
 * игрока. Тип выводится из include-конфигурации запроса, а не переписывается
 * руками — иначе список админки расходится с колонками молча.
 */
export type LedgerEntryAdminRow = Prisma.LedgerEntryGetPayload<{
  include: { walletAccount: { select: { currency: true } }; user: { select: { email: true } } }
}>

/**
 * То же без `user`: история проводок игрока принадлежит самому игроку, и
 * джойнить таблицу пользователей на каждую страницу незачем.
 */
export type LedgerEntryOwnerRow = Prisma.LedgerEntryGetPayload<{
  include: { walletAccount: { select: { currency: true } } }
}>

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
  /**
   * Админский список проводок (ТЗ ч.3 UC-PAY-16) с фильтрами и пагинацией.
   *
   * `ledger_entries` принадлежит wallet, поэтому запрос здесь: presentation не
   * имеет права ходить в БД (гард G27), а consumer видит только фасад.
   */
  listEntries(args: {
    userId?: string | undefined
    type?: LedgerEntryType | undefined
    currency?: Currency | undefined
    page: number
    perPage: number
  }): Promise<[LedgerEntryAdminRow[], number]>
  /**
   * История проводок игрока (`GET /wallet/transactions`, GAP-55 §11).
   *
   * `userId` обязателен типом: эндпоинт отдаёт данные конкретного игрока, и
   * «забыть фильтр» здесь означало бы отдать чужой журнал. Границы периода
   * (`from`/`to`) собраны вызывающим — здесь только `gte`/`lte`.
   */
  listOwnerEntries(args: {
    userId: string
    type?: LedgerEntryType | undefined
    currency?: Currency | undefined
    from?: Date | undefined
    to?: Date | undefined
    page: number
    perPage: number
  }): Promise<[LedgerEntryOwnerRow[], number]>
  /**
   * Проводки, выпущенные по конкретной платёжной заявке, — для карточки заявки.
   *
   * Связь лежит в `metadata.payment_request_id` (jsonb), поэтому без пагинации:
   * у одной заявки их несколько десятков строк не бывает, а резать список
   * произвольным лимитом значило бы молча врать админу.
   */
  findEntriesForPayment(paymentRequestId: string): Promise<LedgerEntry[]>
  /**
   * Статусы заявок игрока по id — `payment_status` в строке истории (GAP-55 §11).
   *
   * `payment_requests` принадлежит payments, но это ЧТЕНИЕ по ADR GAP-51 (так
   * же читает их affiliate в `sumPlayerDeposits`). Через `PaymentsFacade`
   * нельзя: `payments → wallet` уже импорт модуля, а обратный дал бы цикл
   * модулей — `forwardRef` в этом репозитории не используется ни разу.
   *
   * `userId` в фильтре — граница, а не оптимизация: без него по списку чужих
   * id вернулись бы чужие статусы (IDOR).
   */
  findPaymentStatuses(userId: string, ids: string[]): Promise<PaymentStatusById[]>
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
