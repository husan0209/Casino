/** Домен health-модуля: типы отчёта готовности и порт пробы зависимости (GAP-35).
 *
 * Проба (probe) — проверка одной внешней зависимости (БД, Redis). Use-case
 * агрегирует пробы в отчёт, presentation отдаёт его по HTTP. Чистый слой:
 * без Nest/Prisma/IO — только контракты.
 */

/** Статус одной пробы зависимости. */
export type ProbeStatus = 'ok' | 'fail' | 'degraded'

/** Имена проб — ключи отчёта /health/ready (формат ответа зафиксирован). */
export type ProbeName = 'db' | 'redis'

/** Результаты проб по именам (входит в тело ответа /health/ready). */
export type HealthCheckResults = Record<ProbeName, ProbeStatus>

/** Отчёт готовности: готов ли сервис принимать трафик и деградировал ли он. */
export interface HealthReport {
  /** БД доступна — иначе presentation отдаёт 503 (fail-closed) */
  ready: boolean
  /** Redis недоступен — queue-only деградация: 200, но degraded:true */
  degraded: boolean
  /** Статусы всех проб по именам */
  checks: HealthCheckResults
}

/** Порт проверки одной зависимости (реализации — в infrastructure/probes). */
export interface IHealthProbe {
  readonly name: ProbeName
  check(): Promise<ProbeStatus>
}

/** Токен Nest-DI: набор проб readiness (порядок не важен). */
export const HEALTH_PROBES = Symbol('HEALTH_PROBES')
