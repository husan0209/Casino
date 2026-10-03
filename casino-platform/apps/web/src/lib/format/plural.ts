/**
 * Русские счётчики: «1 игра», «2 игры», «5 игр». Без склонения UI читается как
 * машинный перевод (ТЗ ч.5.1 §5 — тон голоса).
 */
type Forms = readonly [one: string, few: string, many: string]

const GAME_FORMS: Forms = ['игра', 'игры', 'игр']

function pluralRu(count: number, [one, few, many]: Forms): string {
  const teen = Math.abs(count) % 100
  if (teen > 10 && teen < 20) {
    return many
  }
  const last = teen % 10
  if (last === 1) {
    return one
  }
  if (last > 1 && last < 5) {
    return few
  }
  return many
}

/** Готовая строка счётчика игр: `2 игры`, `7 игр`, `21 игра`. */
export function gameCountLabel(count: number): string {
  return `${count} ${pluralRu(count, GAME_FORMS)}`
}

const PLAYER_FORMS: Forms = ['игрок', 'игрока', 'игроков']

/** Готовая строка счётчика игроков: `1 игрок`, `4 игрока`, `26 игроков`. */
export function playersCountLabel(count: number): string {
  return `${count} ${pluralRu(count, PLAYER_FORMS)}`
}
