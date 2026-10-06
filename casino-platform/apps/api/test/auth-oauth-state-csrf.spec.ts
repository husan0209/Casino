import { afterEach, describe, expect, it, vi } from 'vitest'

import { OAUTH_STATE_COOKIE, setOAuthStateCookie } from '../src/common/cookies/oauth-state-cookie'
import { GoogleOAuthUseCase } from '../src/modules/auth/application/use-cases/oauth/google-oauth.use-case'
import { OAuthStateError } from '../src/modules/auth/domain/errors'

import type { OAuthSignInResult } from '../src/modules/auth/application/use-cases/oauth/oauth-user-provisioning.service'

/**
 * Привязка OAuth `state` к браузеру (login CSRF).
 *
 * Подпись на `state` доказывает только то, что его выдал наш сервер. `GET
 * /auth/google/url` анонимный, поэтому без сверки с кукой атакующий может:
 *   1) получить валидный `state` у себя;
 *   2) пройти Google и получить `code` на СВОЙ аккаунт;
 *   3) заставить жертву отправить `POST /auth/google` с этой парой.
 * Жертва оказывается залогиненной в аккаунт атакующего: депозит и ставки
 * уходят на его баланс, атрибуция тоже. Кука замыкает цепочку «начал вход =
 * завершил вход», и эти тесты проверяют именно это, а не подпись (подпись
 * покрыта в oauth-verify.spec.ts).
 */
const CONFIG: Record<string, string> = {
  JWT_ACCESS_SECRET: 'test-jwt-secret-for-oauth-state',
  GOOGLE_CLIENT_ID: 'google-client-id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'GOCSPX-test_secret_value',
  APP_URL: 'https://example.com',
}

const USER_INFO = { sub: 'google-sub-1', email: 'g@gmail.com', email_verified: true }

function makeUc() {
  const fetchCalls: string[] = []
  const fetchMock = vi.fn(async (url: string | URL) => {
    fetchCalls.push(String(url))
    const isToken = String(url).includes('/token')
    return {
      ok: true,
      status: 200,
      json: async () => (isToken ? { access_token: 'provider-access-token' } : USER_INFO),
    }
  })
  vi.stubGlobal('fetch', fetchMock)

  const signInResult: OAuthSignInResult = {
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    user: { id: 'u-1', email: 'g@gmail.com', role: 'user' },
    wasLinked: false,
  }
  const signIn = vi.fn(async () => signInResult)
  const config = { get: (key: string) => CONFIG[key] } as never
  const uc = new GoogleOAuthUseCase(config, { signIn } as never)
  return { uc, signIn, fetchCalls, state: uc.buildAuthUrl('https://example.com/cb').state }
}

describe('GoogleOAuthUseCase: state обязан прийти из куки этого браузера', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('валидный state без куки → OAuthStateError, до Google не идём', async () => {
    const h = makeUc()

    await expect(h.uc.execute({ code: 'code-1', state: h.state })).rejects.toBeInstanceOf(
      OAuthStateError,
    )
    expect(h.fetchCalls).toEqual([])
    expect(h.signIn).not.toHaveBeenCalled()
  })

  it('пустая кука считается отсутствующей', async () => {
    const h = makeUc()

    await expect(
      h.uc.execute({ code: 'code-1', state: h.state, stateCookie: '' }),
    ).rejects.toBeInstanceOf(OAuthStateError)
  })

  it('state атакующего с кукой жертвы → OAuthStateError (собственно CSRF)', async () => {
    const attacker = makeUc()
    const victim = makeUc()

    await expect(
      victim.uc.execute({
        code: 'attacker-code',
        state: attacker.state,
        stateCookie: victim.state,
      }),
    ).rejects.toBeInstanceOf(OAuthStateError)
    expect(attacker.fetchCalls).toEqual([])
    expect(victim.signIn).not.toHaveBeenCalled()
  })

  it('совпадение с кукой — вход проходит обычным путём', async () => {
    const h = makeUc()

    const res = await h.uc.execute({ code: 'code-1', state: h.state, stateCookie: h.state })

    expect(res.accessToken).toBe('access-1')
    expect(h.signIn).toHaveBeenCalledTimes(1)
    expect(h.fetchCalls.length).toBe(2)
  })
})

describe('setOAuthStateCookie: где и как живёт state', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('httpOnly + sameSite=strict + path только для auth-эндпоинтов', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const cookie = vi.fn()

    setOAuthStateCookie({ cookie } as never, 'state-value')

    expect(cookie).toHaveBeenCalledWith('oauth_state', 'state-value', {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: expect.any(Number),
      path: '/api/v1/auth',
    })
  })

  it('вне прода secure выключен, остальное те же флаги', () => {
    vi.stubEnv('NODE_ENV', 'development')
    const cookie = vi.fn()

    setOAuthStateCookie({ cookie } as never, 'state-value')

    const options = cookie.mock.calls[0]?.[2] as Record<string, unknown>
    expect(options.secure).toBe(false)
    expect(options.httpOnly).toBe(true)
  })

  it('имя куки в одном месте — контроллер читает тот же константный ключ', () => {
    expect(OAUTH_STATE_COOKIE).toBe('oauth_state')
  })
})
