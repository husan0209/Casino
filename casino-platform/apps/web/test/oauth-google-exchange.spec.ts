import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * UC-AUTH-08: обмен `code` на сессию. `state` обязателен в теле: API сверяет его
 * с кукой `oauth_state`, выданной на `GET /auth/google/url` (защита от login
 * CSRF). Фронт брал из callback-а только `code`, поэтому вход через Google
 * отбивался на 400 уже ПОСЛЕ того, как пользователь ввёл пароль в Google.
 */

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }))

vi.mock('@/lib/api', () => api)

import { exchangeGoogleCode } from '@/components/auth/oauth'

beforeEach(() => {
  api.apiGet.mockReset()
  api.apiPost.mockReset()
  window.sessionStorage.clear()
})

describe('exchangeGoogleCode', () => {
  it('отправляет code, redirect_uri и state из query callback-а', async () => {
    api.apiPost.mockResolvedValue({ accessToken: 'token', user: { id: 'u1' } })
    window.history.replaceState(null, '', '/auth/google/callback?code=CODE42&state=STATE77')

    await exchangeGoogleCode()

    expect(api.apiPost).toHaveBeenCalledWith('/auth/google', {
      code: 'CODE42',
      redirect_uri: `${window.location.origin}/auth/google/callback`,
      state: 'STATE77',
      referral_code: undefined,
    })
  })

  it('реферальный код из sessionStorage доезжает до обмена и снимается после', async () => {
    api.apiPost.mockResolvedValue({ accessToken: 'token', user: { id: 'u1' } })
    window.sessionStorage.setItem('oauth_referral_code', 'REF9')
    window.history.replaceState(null, '', '/auth/google/callback?code=CODE42&state=STATE77')

    await exchangeGoogleCode()

    expect(api.apiPost).toHaveBeenCalledWith(
      '/auth/google',
      expect.objectContaining({ referral_code: 'REF9' }),
    )
    expect(window.sessionStorage.getItem('oauth_referral_code')).toBeNull()
  })

  it('не идёт в обмен, если Google вернул ошибку вместо code', async () => {
    window.history.replaceState(null, '', '/auth/google/callback?error=access_denied&state=STATE77')

    await expect(exchangeGoogleCode()).rejects.toThrow('access_denied')
    expect(api.apiPost).not.toHaveBeenCalled()
  })
})
