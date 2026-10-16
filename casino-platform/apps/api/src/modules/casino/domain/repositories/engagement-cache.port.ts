/**
 * ТЗ ч.9 §6.4 — порт кэша Engagement Score.
 *
 * Score меняется медленно и читается на каждом спине, поэтому кэшируется в
 * Redis на 5 минут. Порт в домене нужен, чтобы тесты движка не тянули Redis.
 */
export interface IEngagementCache {
  getScore(userId: string, gameId: string): Promise<number | null>
  setScore(userId: string, gameId: string, score: number): Promise<void>
  /** Сброс пары (игрок, игра) — вызывается после пересчёта из БД. */
  invalidate(userId: string, gameId: string): Promise<void>
}

export const ENGAGEMENT_CACHE = Symbol('ENGAGEMENT_CACHE')

/** §6.4 — шаблон ключа Redis. */
export function engagementScoreKey(userId: string, gameId: string): string {
  return `engagement:score:${userId}:${gameId}`
}
