/**
 * ТЗ ч.9 §5.1 — фаза вовлечения игрока.
 *
 * Доменное перечисление хранится в БД одноимённым enum (`EngagementPhase`),
 * поэтому значения совпадают с примитивами Prisma — маппинг «строка → enum»
 * в mappers/engagement.mapper.ts сводится к проверке в множестве.
 */

/** Фаза вовлечения игрока (ТЗ ч.9 §5.1). */
export type EngagementPhase =
  'onboarding' | 'retention' | 'risk' | 'reactivation' | 'cooldown' | 'dormant'

export const ENGAGEMENT_PHASES: readonly EngagementPhase[] = [
  'onboarding',
  'retention',
  'risk',
  'reactivation',
  'cooldown',
  'dormant',
]

export function isEngagementPhase(value: unknown): value is EngagementPhase {
  return typeof value === 'string' && (ENGAGEMENT_PHASES as readonly string[]).includes(value)
}

/**
 * ТЗ ч.9 §17: в COOLDOWN и DORMANT механики не применяются.
 * Функция — единственное место, где это правило выражено в коде, чтобы
 * LDW/Near-Miss нельзя было включить «случайно» в терминальной фазе.
 */
export function mechanicsAllowedIn(phase: EngagementPhase): boolean {
  return phase !== 'cooldown' && phase !== 'dormant'
}
