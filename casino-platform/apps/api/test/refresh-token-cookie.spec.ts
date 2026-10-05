import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clearRefreshTokenCookie,
  setRefreshTokenCookie,
} from '../src/common/cookies/refresh-token-cookie'

/**
 * Кука refresh-токена: флаги безопасности и срок жизни.
 *
 * Раньше `maxAge` был захардкожен 30 сутками независимо от `JWT_REFRESH_EXPIRES_IN`,
 * поэтому при окне в 7 дней кука пережила бы отозванную сессию: клиент слал бы
 * заведомо невалидный refresh. Здесь же фиксируются httpOnly/secure/sameSite/path —
 * их потеря не видна ни одному другому тесту (контроллеры их не проверяют).
 */
interface CookieCall {
  name: string
  value: string
  options: Record<string, unknown>
}

function responseStub(): { res: { cookie: ReturnType<typeof vi.fn> }; calls: CookieCall[] } {
  const calls: CookieCall[] = []
  const cookie = vi.fn((name: string, value: string, options: Record<string, unknown>) => {
    calls.push({ name, value, options })
  })
  return { res: { cookie }, calls }
}

describe('setRefreshTokenCookie', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('в проде: httpOnly + secure + sameSite=strict, область — только /api/v1/auth', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { res, calls } = responseStub()

    setRefreshTokenCookie(res as never, 'token-1')

    expect(calls[0]!.name).toBe('refresh_token')
    expect(calls[0]!.value).toBe('token-1')
    expect(calls[0]!.options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/api/v1/auth',
    })
  })

  it('вне прода secure выключен (dev на http://localhost), остальное — то же', () => {
    vi.stubEnv('NODE_ENV', 'development')
    const { res, calls } = responseStub()

    setRefreshTokenCookie(res as never, 'token-2')

    expect(calls[0]!.options.secure).toBe(false)
    expect(calls[0]!.options.httpOnly).toBe(true)
    expect(calls[0]!.options.sameSite).toBe('strict')
  })

  it('срок куки = JWT_REFRESH_EXPIRES_IN, а не 30 суток из головы', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('JWT_REFRESH_EXPIRES_IN', '7d')
    const { res, calls } = responseStub()

    setRefreshTokenCookie(res as never, 'token-3')

    expect(calls[0]!.options.maxAge).toBe(7 * 86_400_000)
  })

  it('без конфигурации — резерв 30 суток; мусорное значение не даёт NaN', () => {
    vi.stubEnv('JWT_REFRESH_EXPIRES_IN', undefined)
    const without = responseStub()
    setRefreshTokenCookie(without.res as never, 'a')
    expect(without.calls[0]!.options.maxAge).toBe(30 * 86_400_000)

    vi.stubEnv('JWT_REFRESH_EXPIRES_IN', 'месяц')
    const garbage = responseStub()
    setRefreshTokenCookie(garbage.res as never, 'b')
    expect(garbage.calls[0]!.options.maxAge).toBe(30 * 86_400_000)
  })

  it('logout снимает куку по тому же path, иначе она переживёт выход', () => {
    const clearCookie = vi.fn()
    const res = { clearCookie } as never

    clearRefreshTokenCookie(res)

    expect(clearCookie).toHaveBeenCalledWith('refresh_token', { path: '/api/v1/auth' })
  })
})
