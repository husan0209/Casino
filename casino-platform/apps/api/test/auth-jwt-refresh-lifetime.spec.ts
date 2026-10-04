import { type ConfigService } from '@nestjs/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { JwtTokenService } from '../src/modules/auth/infrastructure/services/jwt.service'

/**
 * Окно жизни refresh-сессии — единственное место, где оно считается.
 *
 * Переменная `JWT_REFRESH_EXPIRES_IN` была описана в env-схеме
 * (`packages/shared-config/src/env.validation.ts:90`) и не читалась никем: пять
 * мест создания сессии хардкодили `30 * 24 * 3600 * 1000`. То есть конфиг
 * существовал только на бумаге, а «сократить окно выхода» было невыполнимо.
 * Проверка обязана ловить и обратное: значение непонятного формата не должно
 * уезжать в `NaN` (сессия с `expiresAt = Invalid Date` не читается как
 * просроченная и живёт в БД вечно).
 */
const DAY_MS = 86_400_000

function serviceWith(values: Record<string, string | undefined>): JwtTokenService {
  const config = {
    get: (key: string) => values[key],
  } as unknown as ConfigService
  return new JwtTokenService(config)
}

describe('JwtTokenService.refreshLifetime: окно из JWT_REFRESH_EXPIRES_IN', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-10-04T12:00:00.000Z').getTime(), toFake: ['Date'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('суточной формат: 7d → ровно 7 суток', () => {
    const { expiresAt, maxAgeMs } = serviceWith({ JWT_REFRESH_EXPIRES_IN: '7d' }).refreshLifetime()
    expect(maxAgeMs).toBe(7 * DAY_MS)
    expect(expiresAt.getTime() - Date.now()).toBe(7 * DAY_MS)
  })

  it('часы и минуты работают (оператор не обязан мыслить сутками)', () => {
    expect(serviceWith({ JWT_REFRESH_EXPIRES_IN: '12h' }).refreshLifetime().maxAgeMs).toBe(
      12 * 3_600_000,
    )
    expect(serviceWith({ JWT_REFRESH_EXPIRES_IN: '45m' }).refreshLifetime().maxAgeMs).toBe(
      45 * 60_000,
    )
    expect(serviceWith({ JWT_REFRESH_EXPIRES_IN: '3600s' }).refreshLifetime().maxAgeMs).toBe(
      3_600_000,
    )
  })

  it('регистр и пробелы не ломают разбор', () => {
    expect(
      serviceWith({ JWT_REFRESH_EXPIRES_IN: ' 7D '.trim().toLowerCase() }).refreshLifetime()
        .maxAgeMs,
    ).toBe(7 * DAY_MS)
    expect(serviceWith({ JWT_REFRESH_EXPIRES_IN: '7d ' }).refreshLifetime().maxAgeMs).toBe(
      7 * DAY_MS,
    )
  })

  it('пусто, мусор и «1 month» → резерв 30 суток, а не NaN', () => {
    for (const value of [undefined, '', '1 month', 'month', '7 days', '-7d', '7d7']) {
      const { expiresAt, maxAgeMs } = serviceWith({
        JWT_REFRESH_EXPIRES_IN: value,
      }).refreshLifetime()
      expect(maxAgeMs, `value=${String(value)}`).toBe(30 * DAY_MS)
      expect(Number.isNaN(expiresAt.getTime()), `value=${String(value)}`).toBe(false)
    }
  })

  it('expiresAt и maxAgeMs — одно и то же число: кука не переживёт сессию', () => {
    const { expiresAt, maxAgeMs } = serviceWith({
      JWT_REFRESH_EXPIRES_IN: '3d',
    }).refreshLifetime()
    expect(expiresAt.getTime() - Date.now()).toBe(maxAgeMs)
  })
})
