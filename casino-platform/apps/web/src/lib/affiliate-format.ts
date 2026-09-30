/**
 * Форматирование денег и процентов в кабинете партнёра.
 *
 * ВСЕ суммы приходят строками (API_CONVENTIONS §10.1). `Number()` здесь
 * применяется ТОЛЬКО для отображения — никакой арифметики на клиенте, которая
 * влияла бы на результат. Деньги, которые меняются, считает только бэкенд на
 * Decimal.
 */

/** Суффикс валюты для отображения. Крипта — тикер, фиат — знак рубля. */
const CURRENCY_SUFFIX: Record<string, string> = {
  RUB: '₽',
  USDT_TRC20: 'USDT',
  BTC: 'BTC',
  TON: 'TON',
  TRX: 'TRX',
  LTC: 'LTC',
}

export function formatMoney(amount: string, currency: string): string {
  const numeric = Number(amount)
  if (!Number.isFinite(numeric)) {
    return `${amount} ${currencySuffix(currency)}`
  }
  // RUB показываем с копейками, крипту — 8 знаков (точность DECIMAL(20,8)).
  const digits = currency === 'RUB' ? 2 : 8
  return `${numeric.toLocaleString('ru-RU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} ${currencySuffix(currency)}`
}

/** Сумма без валюты — для колонок таблиц, где валюта вынесена в заголовок. */
export function formatAmount(amount: string, currency: string): string {
  const numeric = Number(amount)
  if (!Number.isFinite(numeric)) {
    return amount
  }
  const digits = currency === 'RUB' ? 2 : 8
  return numeric.toLocaleString('ru-RU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function currencySuffix(currency: string): string {
  return CURRENCY_SUFFIX[currency] ?? currency
}

/** Ставка из строки rate ("0.2000") в проценты ("20%"). */
export function formatRate(rate: string): string {
  const numeric = Number(rate)
  if (!Number.isFinite(numeric)) {
    return rate
  }
  const percent = numeric * 100
  return `${Number.isInteger(percent) ? percent : percent.toFixed(1)}%`
}

/**
 * Человеческие названия статусов.
 *
 * Статусы — технические enum'ы партнёрской программы. Партнёр не должен
 * угадывать, что значит `qualified`, поэтому показываем по-русски.
 */
const STATUS_LABELS: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted' }> = {
  active: { label: 'Активен', tone: 'ok' },
  suspended: { label: 'Приостановлен', tone: 'warn' },
  rejected: { label: 'Отклонён', tone: 'bad' },
  pending: { label: 'Ожидает', tone: 'warn' },
  approved: { label: 'Начислено', tone: 'ok' },
  paid: { label: 'Выплачено', tone: 'ok' },
  cancelled: { label: 'Отменено', tone: 'muted' },
  qualified: { label: 'Квалифицирован', tone: 'ok' },
  zero: { label: 'Ноль', tone: 'muted' },
}

export function statusLabel(value: string): {
  label: string
  tone: 'ok' | 'warn' | 'bad' | 'muted'
} {
  return STATUS_LABELS[value] ?? { label: value, tone: 'muted' }
}

/** Тон для statusLabel → классы плашки. Держим палитру проекта (globals.css). */
export function statusToneClass(tone: 'ok' | 'warn' | 'bad' | 'muted'): string {
  switch (tone) {
    case 'ok':
      return 'bg-[#00C853]/15 text-[#00C853]'
    case 'warn':
      return 'bg-[#FFB300]/15 text-[#FFB300]'
    case 'bad':
      return 'bg-[#FF3D71]/15 text-[#FF3D71]'
    default:
      return 'bg-white/8 text-[#8888AA]'
  }
}

/**
 * Причины отказа в квалификации — партнёр должен понимать, почему игрок не
 * засчитан, иначе он не может исправить качество своего трафика.
 */
const REJECT_LABELS: Record<string, string> = {
  self_referral: 'Самопривлечение',
  self_exclusion: 'Игрок самоисключился',
  fraud: 'Обнаружен фрод',
  chargeback: 'Чарджбэк',
  kyc_fail: 'Не пройден KYC',
  dormancy: 'Нет активности',
  ip_flood: 'Подозрение на флуд трафика',
  near_threshold_deposit: 'Депозит ровно на порог',
  manual: 'Отказ администратора',
}

export function rejectReasonLabel(reason: string | null): string | null {
  if (reason === null) {
    return null
  }
  return REJECT_LABELS[reason] ?? reason
}
