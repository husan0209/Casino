import { describe, expect, it } from 'vitest'

/**
 * GAP-44: smoke-тест errText в admin-клиенте.
 * Минимум для закрытия GAP-44.4 (smoke-тест админки), полное покрытие —
 * отдельный PR с jsdom + @testing-library/react.
 *
 * ApiResponse — локальный тип в apps/admin/src/lib/api.ts (не экспортирован).
 * Для теста кастуем через `unknown` — нам важен только response.data.
 */
import { errText } from '../src/lib/api'

function axiosError(data: { error?: { message?: string }; message?: string }): unknown {
  return {
    isAxiosError: true,
    name: 'AxiosError',
    message: 'Request failed',
    response: { data, status: 422 },
  }
}

describe('GAP-44 admin errText', () => {
  it('извлекает error.message из envelope', () => {
    const e = axiosError({ error: { message: 'Доступ запрещён' } })
    expect(errText(e)).toBe('Доступ запрещён')
  })

  it('фолбэк на message', () => {
    const e = axiosError({ message: 'Просто сообщение' })
    expect(errText(e)).toBe('Просто сообщение')
  })

  it('фолбэк на Error.message для не-axios ошибок', () => {
    expect(errText(new Error('boom'))).toBe('boom')
  })

  it('фолбэк на "Ошибка" для unknown', () => {
    expect(errText(null)).toBe('Ошибка')
    expect(errText(undefined)).toBe('Ошибка')
  })
})
