/**
 * GAP-55 (з) (ТЗ ч.5 §10.3): чистая логика WithdrawSheet.
 * Порядок проверок до формы (§10.3) и валидация реквизитов живут здесь, а не
 * в компоненте (конвенция GAP-44), поэтому покрываются тестами без jsdom.
 *
 * Важно: формат адреса различает сети — TRC20-адрес не должен проходить
 * валидацию BTC и наоборот (§10.3 «сеть сменить нельзя», «TRC20-адрес не должен
 * проходить валидацию BTC»). Подпись валюты — currencyLabel() из lib/format/currency,
 * не здесь (единый источник, ТЗ §2.5).
 */
import { money } from '@casino/shared-utils'

export type WithdrawMethod = 'card' | 'sbp'

export interface WalletLike {
  currency: string
  available: string
}

/** Минимумы/максимумы совпадают с CreateWithdrawalUseCase (бэк — источник правды). */
export const WITHDRAW_LIMITS: Record<string, { min: string; max: string }> = {
  RUB: { min: '500', max: '200000' },
  USDT_TRC20: { min: '0.001', max: '999999' },
  BTC: { min: '0.001', max: '999999' },
}

export function limitsFor(currency: string): { min: string; max: string } {
  return WITHDRAW_LIMITS[currency] ?? { min: '0.001', max: '999999' }
}

/** Пресеты только для активной валюты (§2.5); у BTC пресетов нет. */
export function withdrawPresets(currency: string): string[] {
  if (currency === 'RUB') {
    return ['1000', '2000', '5000', '10000']
  }
  if (currency === 'USDT_TRC20') {
    return ['20', '50', '100', '200']
  }
  return []
}

const CARD_RE = /^\d{16,19}$/
const SBP_RE = /^\d{11}$/
// Base58 без 0OIl: T + 33 символа
const TRC20_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/
// legacy (1/3 + 25–34), bech32 (bc1 + 26–71) и taproot (bc1p)
const BTC_RE = /^(?:[13][1-9A-HJ-NP-Za-km-z]{24,33}|bc1[a-z0-9]{25,71})$/

/**
 * Валидация реквизитов. Возвращает текст ошибки или null, если всё в порядке.
 * Бэкенд принимает destination строкой (CreateFiatWithdrawalSchema/CreateCryptoWithdrawalSchema),
 * поэтому номер карты принимаем без пробелов/дефисов (нормализуем на входе).
 */
const CRYPTO_ADDRESS_RULES: Record<string, { pattern: RegExp; hint: string }> = {
  USDT_TRC20: { pattern: TRC20_RE, hint: 'Адрес USDT в сети TRC20 начинается с T (34 символа)' },
  BTC: { pattern: BTC_RE, hint: 'Адрес BTC: 1\u2026 / 3\u2026 / bc1\u2026' },
}

export function validateDestination(input: {
  currency: string
  method?: WithdrawMethod | undefined
  value: string
}): string | null {
  const raw = input.value.trim()
  if (raw === '') {
    return 'Укажите реквизиты'
  }
  if (input.currency === 'RUB') {
    return validateFiatDestination(raw, input.method)
  }
  return validateCryptoDestination(raw, input.currency)
}

function validateFiatDestination(raw: string, method?: WithdrawMethod): string | null {
  if (method === 'sbp') {
    return SBP_RE.test(raw) ? null : 'Телефон из 11 цифр, например 79991234567'
  }
  const digits = raw.replace(/[\s-]/g, '')
  if (!/^\d+$/.test(digits)) {
    return 'Номер карты — только цифры'
  }
  return CARD_RE.test(digits) ? null : 'Номер карты — 16–19 цифр'
}

function validateCryptoDestination(raw: string, currency: string): string | null {
  const rule = CRYPTO_ADDRESS_RULES[currency]
  if (!rule) {
    return 'Неизвестная валюта'
  }
  return rule.pattern.test(raw) ? null : rule.hint
}

/** Нормализованный destination для API (карта — без пробелов и дефисов). */
export function normalizeDestination(input: {
  currency: string
  method?: WithdrawMethod | undefined
  value: string
}): string {
  const raw = input.value.trim()
  if (input.currency === 'RUB' && input.method !== 'sbp') {
    return raw.replace(/[\s-]/g, '')
  }
  return raw
}

export interface AmountCheck {
  ok: boolean
  reason?: 'format' | 'min' | 'max' | 'insufficient'
}

/**
 * Сумма: формат, минимум/максимум валюты и доступный остаток (locked не трогаем —
 * в выводе участвует available). Деньги — Decimal через money.* (number запрещён).
 */
export function checkWithdrawAmount(input: {
  amount: string
  currency: string
  available: string
}): AmountCheck {
  const raw = input.amount.trim().replace(/\s/g, '')
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    return { ok: false, reason: 'format' }
  }
  const limits = limitsFor(input.currency)
  if (!money.isGreaterOrEqual(raw, limits.min)) {
    return { ok: false, reason: 'min' }
  }
  if (!money.isGreaterOrEqual(limits.max, raw)) {
    return { ok: false, reason: 'max' }
  }
  if (!money.isGreaterOrEqual(input.available, raw)) {
    return { ok: false, reason: 'insufficient' }
  }
  return { ok: true }
}

/**
 * §10.3 — проверки ДО формы, строгий порядок:
 *  1. KYC не approved → стоп, одна кнопка «Пройти верификацию», без формы;
 *  2. активный кошелёк пустой и денег нет нигде → «Нечего выводить»;
 *  3. активный пустой, в другом есть → предложить ту валюту (не открывать нулевую форму);
 *  4. иначе — форма в активной валюте.
 */
export type WithdrawPrecheck =
  | { kind: 'kyc_required' }
  | { kind: 'nothing_to_withdraw' }
  | { kind: 'suggest_currency'; from: string; to: string; amount: string }
  | { kind: 'form'; currency: string; available: string }

export function resolveWithdrawPrecheck(input: {
  kycApproved: boolean
  activeCurrency: string
  wallets: WalletLike[]
}): WithdrawPrecheck {
  if (!input.kycApproved) {
    return { kind: 'kyc_required' }
  }
  const active = input.wallets.find((wallet) => wallet.currency === input.activeCurrency)
  if (active && money.isPositive(active.available)) {
    return { kind: 'form', currency: active.currency, available: active.available }
  }
  const suggestion = findFundedAlternative(input.wallets, input.activeCurrency)
  if (suggestion) {
    return {
      kind: 'suggest_currency',
      from: input.activeCurrency,
      to: suggestion.currency,
      amount: suggestion.available,
    }
  }
  return { kind: 'nothing_to_withdraw' }
}

/** Другой кошелёк с деньгами (для §10.3 п.3). Стабильный порядок — по коду валюты. */
function findFundedAlternative(
  wallets: WalletLike[],
  excludeCurrency: string,
): WalletLike | undefined {
  return wallets
    .filter((wallet) => wallet.currency !== excludeCurrency)
    .filter((wallet) => money.isPositive(wallet.available))
    .sort((a, b) => b.currency.localeCompare(a.currency))[0]
}

/**
 * Отображение валюты/сети — в lib/format/currency.ts (единый источник);
 * реэкспорт здесь сохраняет стабильный импорт для существующих потребителей.
 */
export { isCryptoCurrency, networkLabel } from '@/lib/format/currency'

/** Подпись способа фиатского вывода (значения совпадают с enum CreateFiatWithdrawalSchema). */
export function fiatMethodLabel(method: WithdrawMethod): string {
  return method === 'sbp' ? 'СБП' : 'Карта'
}

/**
 * Маскировка реквизитов для подтверждения (§SECURITY_BASELINE: карта целиком
 * не показывается и не логируется; адрес — префикс+суффикс).
 */
export function maskDestination(input: {
  currency: string
  method?: WithdrawMethod | undefined
  value: string
}): string {
  const value = normalizeDestination(input)
  if (input.currency === 'RUB' && input.method === 'sbp') {
    return `${value.slice(0, 1)}••• ${value.slice(-4)}`
  }
  if (input.currency === 'RUB') {
    return `•••• ${value.slice(-4)}`
  }
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}
