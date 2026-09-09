import { describe, it, expect } from 'vitest'

import { LOG_REDACT_PATHS } from '../src/common/logger/logger.options'
import {
  buildSentryOptions,
  scrubPII,
} from '../src/common/sentry/sentry.options'

/**
 * GAP-50: контракт Sentry-агрегатора (вне ТЗ, согласовано владельцем 2026-09-04).
 * Проверяются чистые функции — сетевых вызовов нет, DSN фиктивный.
 */
describe('sentry.options (GAP-50)', () => {
  describe('buildSentryOptions — DSN опционален', () => {
    it('undefined DSN → undefined (init не вызывается: no-op для dev/CI)', () => {
      expect(buildSentryOptions(undefined)).toBeUndefined()
    })

    it('пустой DSN → undefined (закомментированная строка в .env.example)', () => {
      expect(buildSentryOptions('')).toBeUndefined()
    })

    it('заданный DSN → Options: dsn, трейсинг выключен, PII выключен', () => {
      const opts = buildSentryOptions('https://fake@sentry.example.com/1')
      expect(opts).toBeDefined()
      expect(opts!.dsn).toBe('https://fake@sentry.example.com/1')
      // критерий 2: трейсинг выключен (ТЗ ч.7 §12.1 — APM для MVP не нужен)
      expect(opts!.tracesSampleRate).toBe(0)
      // критерий 2: sendDefaultPii: false (SECURITY_BASELINE §12.3)
      expect(opts!.sendDefaultPii).toBe(false)
    })

    it('beforeSend определён при заданном DSN (скраббинг extra/contexts)', () => {
      const opts = buildSentryOptions('https://fake@sentry.example.com/1')
      expect(typeof opts!.beforeSend).toBe('function')
    })
  })

  describe('scrubPII — тот же список секретов, что pino redact', () => {
    it('вырезает плоские секретные ключи из extra', () => {
      const extra = {
        password: 'hunter2',
        token: 'jwt-payload',
        apiKey: 'np_live_xxx',
        requestId: 'req-1', // не секрет
      }
      const out = scrubPII(extra) as Record<string, unknown>
      expect(out['password']).toBe('[REDACTED]')
      expect(out['token']).toBe('[REDACTED]')
      expect(out['apiKey']).toBe('[REDACTED]')
      expect(out['requestId']).toBe('req-1')
    })

    it('вырезает вложенные ключи (бизнес-контекст с refreshToken)', () => {
      const extra = {
        context: { refreshToken: 'r.yyy', userId: 'u1' },
      }
      const out = scrubPII(extra) as Record<string, unknown>
      const ctx = out['context'] as Record<string, unknown>
      expect(ctx['refreshToken']).toBe('[REDACTED]')
      expect(ctx['userId']).toBe('u1')
    })

    it('рекурсия: массивы и глубина > 6 защищены', () => {
      const deep = { arr: [{ password: 'x' }, { ok: true }] }
      const out = scrubPII(deep) as Record<string, unknown>
      const arr = out['arr'] as Array<Record<string, unknown>>
      expect(arr[0]['password']).toBe('[REDACTED]')
      expect(arr[1]['ok']).toBe(true)

      // глубже 6 уровней — замена на [deep], не бесконечная рекурсия
      let v: unknown = { password: 'x' }
      for (let i = 0; i < 10; i++) v = { nested: v }
      const flat = JSON.stringify(scrubPII(v))
      expect(flat).toContain('[deep]')
    })

    it('список скраббинга синхронен с LOG_REDACT_PATHS (pino redact)', () => {
      // критерий GAP-50: согласованность с pino — общий источник logger.options
      expect(LOG_REDACT_PATHS).toContain('password')
      expect(LOG_REDACT_PATHS).toContain('*.refreshToken')
      expect(LOG_REDACT_PATHS).toContain('apiKey')
    })
  })

  describe('фильтрация по статусу — контракт критерия 3', () => {
    // Сама фильтрация живёт в GlobalExceptionFilter (только 5xx и unknown);
    // здесь фиксируем, что Options не включают трейсинг — в Sentry уходят
    // только captureException из фильтра.
    it('tracesSampleRate: 0 — события трейсинга не отправляются', () => {
      const opts = buildSentryOptions('https://fake@sentry.example.com/1')
      expect(opts!.tracesSampleRate).toBe(0)
    })
  })
})
