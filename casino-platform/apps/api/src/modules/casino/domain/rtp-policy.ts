/**
 * Политика возвратов house-игр.
 *
 * Деньги — то, что выставил админ в `games.rtp`, и не выше 100 %: обещать
 * отдачу больше ставки казино не может. Демо — `games.rtpDemo`, а если поле
 * пустое, щедрые 120 %: демо-котёл существует затем, чтобы игрок видел игру
 * в плюсе, а не ноль на нуле.
 *
 * Разные движки добираются до цели разными рычагами (слоты — долей выигрышных
 * строк, Plinko — комплектом множителей, Aztec — масштабом таблицы), но цель
 * у всех одна и берётся отсюда.
 */

/** Витринная цель на деньги, если админ не заполнил поле. */
export const MONEY_RTP_DEFAULT_PERCENT = '96'

/** Цель в демо, если админ не заполнил `rtp_demo`. */
export const DEMO_RTP_DEFAULT_PERCENT = 120

/** Потолок щедрости демо: общая страховка от опечатки в админке. */
export const DEMO_RTP_MAX_PERCENT = 200

/** Верх денег: выплата больше собранной ставки невозможна по смыслу RTP. */
const MONEY_RTP_MAX_PERCENT = 100

function toPercent(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') {
    return null
  }
  const parsed = Number(String(raw))
  return Number.isFinite(parsed) ? parsed : null
}

/** Цель на деньги: поле админа либо витринные 96, в диапазоне 0..100. */
export function moneyRtpValue(rawRtp: unknown): number {
  const parsed = toPercent(rawRtp)
  if (parsed === null) {
    return Number(MONEY_RTP_DEFAULT_PERCENT)
  }
  return Math.min(MONEY_RTP_MAX_PERCENT, Math.max(0, parsed))
}

/** Та же цель строкой: лотерея слотов калибруется десятичной строкой процентов. */
export function moneyRtpPercent(rawRtp: unknown): string {
  return String(moneyRtpValue(rawRtp))
}

/**
 * ТЗ ч.9 §7.2 — RTP спина под управлением движка вовлечения.
 *
 * Это явное исключение из `MONEY_RTP_MAX_PERCENT = 100`: базовое значение
 * `games.rtp` по-прежнему режется политикой выше, а движок подставляет свою
 * цель по фазе (ONBOARDING 105–110 %, REACTIVATION 103–108 %), и именно на
 * этом держится «медовый месяц» §4.1. Значение приходит из движка, а не из
 * админского поля, поэтому политику витрины тут не применяем — но верх
 * отсекается теми же границами §7.1/§17 (90…110) и потолком таблицы выплат.
 *
 * Отдельная функция вместо флага в `moneyRtpPercent` — чтобы появление
 * значений больше 100 % в денежном контуре всегда было видно в диффе.
 */
export function engagementRtpPercent(adjustedPercent: number, min = 90, max = 110): string {
  if (!Number.isFinite(adjustedPercent)) {
    return moneyRtpPercent(null)
  }
  return String(Math.min(max, Math.max(min, adjustedPercent)))
}

/** Цель в демо: поле админа либо 120, и никогда выше потолка таблиц игры.
 * Без этого узкая игра (Fortune Ox/Panda умеют ~90 %) ловила бы
 * ORIGINALS_RTP_UNREACHABLE на каждом спине вместо щедрого показа.
 * DEMO_RTP_MAX_PERCENT сверху держит опечатку в админке: 5000 % в поле —
 * это всё ещё демо, а не обещание. */
export function demoRtpValue(rawRtpDemo: unknown, ceilingPercent: number): number {
  const parsed = toPercent(rawRtpDemo) ?? DEMO_RTP_DEFAULT_PERCENT
  const ceiling = Math.min(ceilingPercent, DEMO_RTP_MAX_PERCENT)
  return Math.max(0, Math.floor(Math.min(parsed, ceiling)))
}

/** Та же цель строкой. */
export function demoRtpPercent(rawRtpDemo: unknown, ceilingPercent: number): string {
  return String(demoRtpValue(rawRtpDemo, ceilingPercent))
}
