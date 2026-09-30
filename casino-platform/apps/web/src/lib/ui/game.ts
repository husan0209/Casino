/**
 * GAP-55: отображение игры (витрина/каталог/страница игры).
 *
 * Раньше эти поля читали инлайном и с НЕВЕРНЫМИ именами (snake_case вместо того,
 * что отдаёт API) — бейджи NEW/HOT и кнопка «Демо» молча не рендерились.
 * Логика вынесена сюда и покрыта тестами, чтобы контракт API был зафиксирован,
 * а не «на глаз».
 */
import { formatAmount } from '@/lib/format/currency'

export interface GameBadgeFields {
  isNew?: boolean | undefined
  isPopular?: boolean | undefined
}

export interface GameNameFields {
  name: string
  nameRu?: string | null | undefined
}

/** Русское название, если есть; иначе оригинал (§6.4). */
export function gameDisplayName(game: GameNameFields): string {
  const localized = game.nameRu?.trim() ?? ''
  return localized.length > 0 ? localized : game.name
}

export type GameBadge = 'NEW' | 'HOT' | null

/** §6.4: ОДИН бейдж на карточку — NEW или HOT, не оба. */
export function gameBadge(game: GameBadgeFields): GameBadge {
  if (game.isNew === true) {
    return 'NEW'
  }
  if (game.isPopular === true) {
    return 'HOT'
  }
  return null
}

/** RTP приходит Decimal'ом (строка в JSON) — показываем число без хвостовых нулей. */
export function gameRtpLabel(rtp: number | string | null | undefined): string | null {
  if (rtp === null || rtp === undefined || rtp === '') {
    return null
  }
  const normalized = Number(String(rtp))
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return null
  }
  return `${String(Number(normalized.toFixed(2)))}%`
}

/** Демо-кнопка только когда провайдер реально отдаёт демо (§8.4). */
export function gameHasDemo(hasDemo: boolean | undefined): boolean {
  return hasDemo === true
}

/** Подписи Prisma-enum GameVolatility. */
const VOLATILITY_LABELS: Record<string, string> = {
  low: 'Низкая',
  medium: 'Средняя',
  high: 'Высокая',
  very_high: 'Очень высокая',
}

/**
 * §8.1: волатильность показывается словом. Раньше на странице игры она была
 * захардкожена «Высокая» у всех слотов — то есть врула для половины каталога.
 */
export function gameVolatilityLabel(volatility: string | null | undefined): string | null {
  const key = volatility?.trim() ?? ''
  if (key.length === 0) {
    return null
  }
  // Неизвестное значение с бэка (новый enum) — лучше показать его, чем молчать.
  return VOLATILITY_LABELS[key] ?? key
}

/**
 * Мин. ставка: Decimal'ь приходит строкой («10.00000000»), валюта — активного
 * кошелька, та же, что уходит в launch-запрос. Нуля и пустоты не показываем:
 * «Мин. ставка 0 ₽» выглядит как данные, а не как их отсутствие.
 */
export function gameMinBetLabel(
  minBet: number | string | null | undefined,
  currency: string,
): string | null {
  if (minBet === null || minBet === undefined || minBet === '') {
    return null
  }
  const value = Number(String(minBet))
  if (!Number.isFinite(value) || value <= 0) {
    return null
  }
  return formatAmount(String(minBet), currency)
}

/** Подписи Prisma-enum GameCategory — одна метка у подзаголовка страницы игры. */
const CATEGORY_LABELS: Record<string, string> = {
  slots: 'Слот',
  live_casino: 'Live-казино',
  table_games: 'Настольная',
  instant_games: 'Мгновенная',
  other: 'Игра',
}

/**
 * Категория игры по-русски. Раньше метка была захардкожена «Слот» для всех
 * игр страницы §8.1 — для live и настольных она врала.
 */
export function gameCategoryLabel(category: string | null | undefined): string | null {
  const key = category?.trim() ?? ''
  if (key.length === 0) {
    return null
  }
  return CATEGORY_LABELS[key] ?? null
}
