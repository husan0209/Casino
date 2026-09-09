import { type NodeOptions } from '@sentry/node'
import * as Sentry from '@sentry/node'

import { LOG_REDACT_PATHS } from '../logger/logger.options'

/**
 * GAP-50: конфигурация Sentry-агрегатора ошибок (вне ТЗ, согласовано владельцем
 * 2026-09-04). Единый источник — экспортируется для юнит-теста
 * sentry-options.spec.ts (no-op без DSN, PII-скраббинг).
 *
 * Критерии приёмки GAP-50:
 * - DSN опционален: без него init() не вызывается вообще — dev/CI не шумят
 *   и нет фоновых сетевых попыток;
 * - трейсинг выключен (tracesSampleRate: 0) — ТЗ ч.7 §12.1: APM для MVP
 *   не требуется; включение = отдельное решение владельца;
 * - sendDefaultPii: false + скраббинг тем же списком ключей, что pino redact
 *   (LOG_REDACT_PATHS) — «одна и та же утечка не пролезает через другой канал»
 *   (SECURITY_BASELINE.md §12.3);
 * - в Sentry уходят только необработанные исключения и 5xx — фильтрация
 *   по статусу происходит в GlobalExceptionFilter (критерий 3: AppError и
 *   4xx — штатные ответы API, не сигнал о поломке).
 */

/** Ключи event-объектов Sentry к скраббингу — плоские имена из LOG_REDACT_PATHS. */
const SENTRY_SCRUB_KEYS: ReadonlySet<string> = new Set(
  LOG_REDACT_PATHS.filter((p) => !p.includes('.') && !p.includes('*')),
)

const NESTED_SCRUB_KEYS: ReadonlySet<string> = new Set(
  LOG_REDACT_PATHS.filter((p) => p.startsWith('*.')),
)

/**
 * Рекурсивно вырезать секретные ключи из extra/contexts-подобных объектов.
 * use-case'ы кладут context в exception-данные — чистим тем же списком,
 * что и pino redact (критерий GAP-50: согласованность скраббинга).
 */
export function scrubPII(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    return '[deep]'
  }
  if (Array.isArray(value)) {
    return value.map((v) => scrubPII(v, depth + 1))
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENTRY_SCRUB_KEYS.has(k) || NESTED_SCRUB_KEYS.has(`*.${k}`)) {
        out[k] = '[REDACTED]'
        continue
      }
      out[k] = scrubPII(v, depth + 1)
    }
    return out
  }
  return value
}

/**
 * Инициализация Sentry (вызов из main.ts ДО NestFactory).
 * Без DSN — полный no-op: init не вызывается, сетевых попыток нет.
 * Обёртка изолирует main.ts от широких сгенерированных типов Sentry
 * (no-unsafe-* warnings) — единственный файл, трогающий SDK напрямую,
 * закрывает их локальными типами.
 */
export function initSentry(dsn: string | undefined): void {
  const options = buildSentryOptions(dsn)
  if (options !== undefined) {
    Sentry.init(options)
  }
}

/**
 * Собрать Sentry Options из значения SENTRY_DSN.
 * undefined — DSN не задан: init не нужен (no-op для dev/CI/тестов).
 */
export function buildSentryOptions(dsn: string | undefined): NodeOptions | undefined {
  if (dsn === undefined || dsn === '') {
    return undefined
  }
  return {
    dsn,
    // критерий 2: трейсинг выключен
    tracesSampleRate: 0,
    sendDefaultPii: false,
    // Сгенерированные типы Sentry широкие (no-unsafe-* warnings); сведение
    // к Record в первой строке закрывает any-канал без конфликтов сигнатур.
    beforeSend: (event) => {
      const record = event as unknown as Record<string, unknown>
      const extra = record['extra']
      if (extra !== undefined) {
        record['extra'] = scrubPII(extra)
      }
      const contexts = record['contexts']
      if (contexts !== undefined) {
        record['contexts'] = scrubPII(contexts)
      }
      return event
    },
  }
}
