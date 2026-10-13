/**
 * GAP-55: отображение игры (витрина/каталог/страница игры).
 *
 * Раньше эти поля читали инлайном и с НЕВЕРНЫМИ именами (snake_case вместо того,
 * что отдаёт API) — бейджи NEW/HOT и кнопка «Демо» молча не рендерились.
 * Логика вынесена сюда и покрыта тестами, чтобы контракт API был зафиксирован,
 * а не «на глаз».
 */

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

/** Демо-кнопка только когда провайдер реально отдаёт демо (§8.4). */
export function gameHasDemo(hasDemo: boolean | undefined): boolean {
  return hasDemo === true
}
