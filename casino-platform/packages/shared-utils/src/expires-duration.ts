/**
 * Разбор TTL из `.env` (`15m`, `7d`, `3600s`) в секунды.
 *
 * Реализация должна быть ОДНА: те же значения читают срок жизни access-токена,
 * срок refresh-сессии и `maxAge` cookie. Две копии разъезжаются незаметно —
 * «30d» начинает означать разное время для токена и для cookie, и разрыв виден
 * пользователю как «выброшен из сессии», а не как конфигурация.
 *
 * Формат: целое число + суффикс `s|m|h|d`. Всё остальное (пусто, `30 d`,
 * `1month`, `abc`) — fallback, без исключения: процесс не должен падать из-за
 * опечатки в env на этапе бутстрапа.
 */
const EXPIRES_PATTERN = /^(\d+)([smhd])$/

const UNIT_SECONDS: Record<'s' | 'm' | 'h' | 'd', number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
}

export function expiresToSeconds(value: string | undefined, fallbackSeconds: number): number {
  if (!value) {
    return fallbackSeconds
  }
  const matched = EXPIRES_PATTERN.exec(value.trim())
  if (!matched?.[1] || !matched[2]) {
    return fallbackSeconds
  }
  const unit = UNIT_SECONDS[matched[2] as keyof typeof UNIT_SECONDS]
  return parseInt(matched[1], 10) * unit
}
