/**
 * GAP-55 (г),(д) (ТЗ ч.5 §11/§12): чистые фильтры двух историй.
 *
 * §11 — история транзакций: тип / валюта / период.
 * §12 — история ставок:   игра / провайдер / валюта / период.
 *
 * Состояние живёт в URL (как в каталоге, §7): ссылки копируются, «назад» работает,
 * а пустые значения не проттекают ни в query, ни в API. Даты — строго
 * YYYY-MM-DD: кривое значение раньше долетало до Prisma как Invalid Date (500).
 *
 * Знак суммы берётся ИЗ САМОЙ СУММЫ: ledger пишет списания отрицательными
 * (`'-' + amount` в wallet.ledger.prisma.ts), поэтому таблица «тип → знак» не
 * нужна и не может разъехаться с новым типом проводки.
 */

import { currencyLabel, formatAmount, networkLabel } from '@/lib/format/currency'

import { money } from '@casino/shared-utils'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Параметры периода: '' — не задан (пустые не попадают ни в URL, ни в API). */
export interface DateRange {
  from: string
  to: string
}

function readDate(search: URLSearchParams, key: string): string {
  const value = search.get(key) ?? ''
  return ISO_DATE.test(value) ? value : ''
}

export function readDateRange(search: URLSearchParams): DateRange {
  return { from: readDate(search, 'from'), to: readDate(search, 'to') }
}

function readClean(search: URLSearchParams, key: string): string {
  return (search.get(key) ?? '').trim()
}

function pushPair(pairs: string[], key: string, value: string): void {
  if (value.length > 0) {
    pairs.push(`${key}=${encodeURIComponent(value)}`)
  }
}

function toHref(path: string, pairs: string[]): string {
  return pairs.length > 0 ? `${path}?${pairs.join('&')}` : path
}

// ── §11 история транзакций ────────────────────────────────────────────────

export interface TxFilter {
  type: string
  currency: string
  from: string
  to: string
}

export const EMPTY_TX_FILTER: TxFilter = { type: '', currency: '', from: '', to: '' }

export function parseTxFilter(search: URLSearchParams): TxFilter {
  const period = readDateRange(search)
  return {
    type: readClean(search, 'type'),
    currency: readClean(search, 'currency'),
    from: period.from,
    to: period.to,
  }
}

export function txApiParams(filter: TxFilter): Record<string, string | undefined> {
  return {
    ...(filter.type && { type: filter.type }),
    ...(filter.currency && { currency: filter.currency }),
    ...(filter.from && { from: filter.from }),
    ...(filter.to && { to: filter.to }),
  }
}

export function txHref(filter: TxFilter, page?: number): string {
  const pairs: string[] = []
  pushPair(pairs, 'type', filter.type)
  pushPair(pairs, 'currency', filter.currency)
  pushPair(pairs, 'from', filter.from)
  pushPair(pairs, 'to', filter.to)
  if (page !== undefined && page > 1) {
    pairs.push(`page=${page}`)
  }
  return toHref('/wallet/transactions', pairs)
}

export function hasActiveTxParts(filter: TxFilter): boolean {
  return Boolean(filter.type || filter.currency || filter.from || filter.to)
}

/** Человекочитаемый тип проводки (enum LedgerEntryType). */
export const TX_TYPE_LABELS: Record<string, string> = {
  DEPOSIT: 'Пополнение',
  WITHDRAWAL: 'Вывод',
  WITHDRAWAL_LOCK: 'Заморозка под вывод',
  WITHDRAWAL_UNLOCK: 'Разморозка вывода',
  WITHDRAWAL_CONFIRM: 'Списание по выводу',
  BET: 'Ставка',
  WIN: 'Выигрыш',
  ROLLBACK: 'Откат ставки',
  BONUS: 'Бонус',
  ADMIN_CREDIT: 'Зачисление',
  ADMIN_DEBIT: 'Списание',
  REFERRAL_REWARD: 'Реферальная награда',
  CONVERSION_DEBIT: 'Обмен — списание',
  CONVERSION_CREDIT: 'Обмен — зачисление',
}

export function txTypeLabel(type: string): string {
  return TX_TYPE_LABELS[type] ?? type
}

/**
 * §11: «+1 000 без валюты — ошибка UI». Знак берём из суммы (ledger пишет
 * списания отрицательными), валюту — из строки проводки.
 */
export function formatTxAmount(amount: string, currency: string): string {
  const formatted = formatAmount(amount, currency)
  return money.isPositive(amount) ? `+${formatted}` : formatted
}

export type AmountDirection = 'in' | 'out' | 'zero'

export function amountDirection(amount: string): AmountDirection {
  if (amount.trim() === '0' || amount.trim() === '0.00') {
    return 'zero'
  }
  return money.isPositive(amount) ? 'in' : 'out'
}

/** metadata проводки — JsonValue; читаем только строковые/числа-в-строке поля. */
export function metadataField(metadata: unknown, key: string): string | null {
  if (typeof metadata !== 'object' || metadata === null) {
    return null
  }
  const value = (metadata as Record<string, unknown>)[key]
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number') {
    return String(value)
  }
  return null
}

/** Для строк заморозки: сумма лежит в metadata.locked_amount (amount = 0). */
export function lockedAmountOf(metadata: unknown): string | null {
  return metadataField(metadata, 'locked_amount')
}

/**
 * §11 «статус»: человекочитаемый статус заявки (enum PaymentStatus на бэке).
 * null — не заявочная проводка (депозит/ставка/выигрыш) либо строка записана
 * до GAP-55, когда ссылка на payment_request в метаданных не проставлялась:
 * статус не выдумываем.
 */
export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: 'на рассмотрении',
  processing: 'обрабатывается',
  completed: 'одобрено',
  failed: 'ошибка',
  cancelled: 'отменено',
  expired: 'истекло',
}

export function paymentStatusLabel(status: string | null): string | null {
  if (status === null) {
    return null
  }
  return PAYMENT_STATUS_LABELS[status] ?? status
}

/** Цвет статуса: ожидающий — нейтральный, успех — зелёный, остальное — красным. */
export function paymentStatusClass(status: string | null): string {
  if (status === 'completed') {
    return 'text-[#00C853]'
  }
  if (status === 'pending' || status === 'processing') {
    return 'text-[#FFB300]'
  }
  if (status === null) {
    return 'text-muted'
  }
  return 'text-[#FF3D71]'
}

/** Сеть для крипто-проводки; для фиата — null (показывать «сеть ₽» бессмысленно). */
export function networkOf(currency: string): string | null {
  return currency === 'RUB' ? null : networkLabel(currency)
}

// ── §12 история ставок ───────────────────────────────────────────────────

export interface BetFilter {
  gameId: string
  provider: string
  currency: string
  from: string
  to: string
}

export const EMPTY_BET_FILTER: BetFilter = {
  gameId: '',
  provider: '',
  currency: '',
  from: '',
  to: '',
}

export function parseBetFilter(search: URLSearchParams): BetFilter {
  const period = readDateRange(search)
  return {
    gameId: readClean(search, 'game'),
    provider: readClean(search, 'provider'),
    currency: readClean(search, 'currency'),
    from: period.from,
    to: period.to,
  }
}

export function betApiParams(filter: BetFilter): Record<string, string | undefined> {
  return {
    ...(filter.gameId && { game_id: filter.gameId }),
    ...(filter.provider && { provider: filter.provider }),
    ...(filter.currency && { currency: filter.currency }),
    ...(filter.from && { from: filter.from }),
    ...(filter.to && { to: filter.to }),
  }
}

export function betHref(filter: BetFilter, page?: number): string {
  const pairs: string[] = []
  pushPair(pairs, 'game', filter.gameId)
  pushPair(pairs, 'provider', filter.provider)
  pushPair(pairs, 'currency', filter.currency)
  pushPair(pairs, 'from', filter.from)
  pushPair(pairs, 'to', filter.to)
  if (page !== undefined && page > 1) {
    pairs.push(`page=${page}`)
  }
  return toHref('/history', pairs)
}

export function hasActiveBetParts(filter: BetFilter): boolean {
  return Boolean(filter.gameId || filter.provider || filter.currency || filter.from || filter.to)
}

export interface BetStatsRow {
  currency: string
  rounds: number
  turnover: string
  wins: string
}

/** Сумма ставок по всем валютам (это количество, не деньги — суммировать можно). */
export function totalRounds(stats: BetStatsRow[]): number {
  return stats.reduce((sum, row) => sum + row.rounds, 0)
}

/**
 * §12: оборот/выигрыши показываем ТОЛЬКО в одной валюте. Смешанную выборку
 * не суммируем — вместо этого даём разбивку по кошелькам.
 */
export function statsForCurrency(stats: BetStatsRow[], currency: string): BetStatsRow | null {
  if (currency.length === 0) {
    return null
  }
  return stats.find((row) => row.currency === currency) ?? null
}

/** Подпись валюты в агрегатах — тот же источник, что и в кассе. */
export function currencyOf(currency: string): string {
  return currencyLabel(currency)
}
