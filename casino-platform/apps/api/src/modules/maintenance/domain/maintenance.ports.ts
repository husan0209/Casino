/** Порты maintenance-job'ов (GAP-33, ТЗ ч.3 §13).
 *
 * Задачи (job) — application-классы; доступ к БД/админ-таблицам/курсам — через
 * порты, чтобы каждую задачу можно было проверить in-memory (criterion 2/3 GAP-33).
 */

/** Платёжка, годная к истечению/напоминанию. */
export interface MaintenancePaymentRow {
  id: string
  createdAt: Date
  provider: string
  /** для крипто-депозитов — expires_at от провайдера (null у фиата) */
  expiresAt: Date | null
  amount?: string
  currency?: string
}

export interface ExpiredCountResult {
  expired: number
  skipped: number
}

export interface ReminderResult {
  reminded: number
  skipped: number
  admins: number
}

export interface RatesResult {
  updated: number
  skipped: number
  source: string
}

/** Доступ к платёжкам для maintenance-задач. */
export interface IPaymentMaintenanceRepo {
  listPendingDeposits(): Promise<MaintenancePaymentRow[]>
  listPendingWithdrawals(): Promise<MaintenancePaymentRow[]>
  markExpired(id: string): Promise<void>
}

/** Дедупликация напоминаний — по записям audit_log за окно. */
export interface IReminderAuditRepo {
  findRecentReminder(withdrawalId: string, since: Date): Promise<boolean>
  recordReminder(input: { targetId: string; adminsNotified: number; count: number }): Promise<void>
  activeAdminEmails(): Promise<string[]>
}

/** Запись курсов (GAP-34 потребляет таблицу; здесь — только запись из cron). */
export interface IExchangeRateWriter {
  saveRate(input: { currencyFrom: string; currencyTo: string; rate: string; source: string }): Promise<void>
  /** best-effort Redis-кеш: сбой не роняет задачу */
  cacheRates(rates: Record<string, string>): Promise<void>
}

/** Источник курсов: NOWPayments /estimate (или dev-stub по константам). */
export interface IRatesProvider {
  estimateRub(currency: string): Promise<{ rate: string; source: string } | null>
}

export const MAINTENANCE_EMAIL_PORT = Symbol('MAINTENANCE_EMAIL_PORT')
export const MAINTENANCE_HANDLERS = Symbol('MAINTENANCE_HANDLERS')

/** Map job.name → хендлер для диспетчера воркера. */
export type MaintenanceHandlers = {
  'expire-deposits': () => Promise<unknown>
  'update-rates': () => Promise<unknown>
  'withdrawal-reminder': () => Promise<unknown>
  'referral-daily': () => Promise<unknown>
}

/** Токены-порты для Nest-DI. */
export const PAYMENT_MAINTENANCE_REPO = Symbol('PAYMENT_MAINTENANCE_REPO')
export const REMINDER_AUDIT_REPO = Symbol('REMINDER_AUDIT_REPO')
export const EXCHANGE_RATE_WRITER = Symbol('EXCHANGE_RATE_WRITER')
export const RATES_PROVIDER = Symbol('RATES_PROVIDER')
