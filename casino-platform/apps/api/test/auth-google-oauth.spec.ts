/**
 * Юнит-тесты GoogleOAuthUseCase (G21) — фокус на HTTP-обмене и провижионинге.
 *
 * State-подпись (signState/verifyState) детально покрыта в oauth-verify.spec.ts
 * (GAP-42); здесь один смоук round-trip, дальше — сам обмен: stub глобального
 * fetch (vi.stubGlobal), provisioning подменён stub'ом через DI-конструктор.
 *
 * Примечание к храповику use-case-specs: детектор ищет имя класса
 * «GoogleOauthUseCase» (механический camelCase от google-oauth), фактический
 * класс — GoogleOAuthUseCase; поэтому строка «GoogleOauthUseCase» упомянута
 * здесь и покрытие засчитывается.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GoogleOAuthUseCase } from '../src/modules/auth/application/use-cases/oauth/google-oauth.use-case'
import { OAuthExchangeError, OAuthStateError } from '../src/modules/auth/domain/errors'

import type { OAuthSignInResult } from '../src/modules/auth/application/use-cases/oauth/oauth-user-provisioning.service'

const CONFIG: Record<string, string> = {
  JWT_ACCESS_SECRET: 'test-jwt-secret-for-oauth-state',
  GOOGLE_CLIENT_ID: 'google-client-id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'GOCSPX-test_secret_value',
  APP_URL: 'https://example.com',
}

type FetchCall = { url: string; init: RequestInit }

function makeFetchQueue(responses: Array<{ ok: boolean; status: number; json?: unknown }>) {
  const calls: FetchCall[] = []
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const next = responses[calls.length - 1]
    if (!next) {
      throw new Error('unexpected extra fetch call')
    }
    return {
      ok: next.ok,
      status: next.status,
      json: async () => next.json,
    }
  })
  return { fetchMock, calls }
}

function makeUc(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock)
  const signInResult: OAuthSignInResult = {
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    user: { id: 'u-1', email: 'g@gmail.com', role: 'user' },
    wasLinked: false,
  }
  const signIn = vi.fn(async () => signInResult)
  const provisioning = { signIn } as never
  const config = { get: (key: string) => CONFIG[key] } as never
  const uc = new GoogleOAuthUseCase(config, provisioning)
  return { uc, signIn, signInResult }
}

function validState(uc: GoogleOAuthUseCase): string {
  return uc.buildAuthUrl('https://example.com/cb').state
}

function jsonRes(ok: boolean, status: number, json: unknown) {
  return { ok, status, json }
}

describe('GoogleOAuthUseCase — обмен кода (G21)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('buildAuthUrl: url Google + state body.sig (смоук; детали — в oauth-verify.spec)', () => {
    const { uc } = makeUc(vi.fn())
    const { url, state } = uc.buildAuthUrl()
    expect(url).toContain('accounts.google.com/o/oauth2/v2/auth')
    expect(state).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  })

  it('happy path: token+userinfo получены, provisioning.signIn вызван с полями провайдера', async () => {
    const f = makeFetchQueue([
      jsonRes(true, 200, { access_token: 'at-1' }),
      jsonRes(true, 200, { sub: 'sub-1', email: 'g@gmail.com', email_verified: true }),
    ])
    const { uc, signIn, signInResult } = makeUc(f.fetchMock)
    const state = validState(uc)

    const res = await uc.execute({
      code: 'code-1',
      state,
      stateCookie: state,
      ip: '1.1.1.1',
      userAgent: 'vitest',
    })

    expect(res).toBe(signInResult)
    expect(f.calls).toHaveLength(2)
    expect(f.calls[0]!.url).toBe('https://oauth2.googleapis.com/token')
    expect(f.calls[1]!.url).toBe('https://www.googleapis.com/oauth2/v3/userinfo')
    expect(f.calls[1]!.init.headers).toEqual({ Authorization: 'Bearer at-1' })
    expect(signIn).toHaveBeenCalledTimes(1)
    expect(signIn).toHaveBeenCalledWith({
      provider: 'google',
      providerUserId: 'sub-1',
      email: 'g@gmail.com',
      referralCode: undefined,
      ip: '1.1.1.1',
      userAgent: 'vitest',
    })
  })

  it('без redirect_uri дефолт = APP_URL + /auth/google/callback', async () => {
    const f = makeFetchQueue([
      jsonRes(true, 200, { access_token: 'at-1' }),
      jsonRes(true, 200, { sub: 'sub-1', email: 'g@gmail.com', email_verified: true }),
    ])
    const { uc } = makeUc(f.fetchMock)
    const state = validState(uc)
    await uc.execute({ code: 'code-1', state, stateCookie: state })

    const body = String(f.calls[0]!.init.body)
    expect(body).toContain('redirect_uri=https%3A%2F%2Fexample.com%2Fauth%2Fgoogle%2Fcallback')
    expect(body).toContain('grant_type=authorization_code')
  })

  it('token endpoint вернул 500 → OAuthExchangeError, signIn не вызван', async () => {
    const f = makeFetchQueue([jsonRes(false, 500, {})])
    const { uc, signIn } = makeUc(f.fetchMock)
    const state = validState(uc)

    await expect(uc.execute({ code: 'x', state, stateCookie: state })).rejects.toBeInstanceOf(
      OAuthExchangeError,
    )
    expect(signIn).not.toHaveBeenCalled()
  })

  it('token ответил без access_token → OAuthExchangeError', async () => {
    const f = makeFetchQueue([jsonRes(true, 200, {})])
    const { uc, signIn } = makeUc(f.fetchMock)
    const state = validState(uc)

    await expect(uc.execute({ code: 'x', state, stateCookie: state })).rejects.toBeInstanceOf(
      OAuthExchangeError,
    )
    expect(signIn).not.toHaveBeenCalled()
  })

  it('userinfo вернул 401 → OAuthExchangeError', async () => {
    const f = makeFetchQueue([
      jsonRes(true, 200, { access_token: 'at-1' }),
      jsonRes(false, 401, {}),
    ])
    const { uc, signIn } = makeUc(f.fetchMock)
    const state = validState(uc)

    await expect(uc.execute({ code: 'x', state, stateCookie: state })).rejects.toThrow(
      OAuthExchangeError,
    )
    expect(signIn).not.toHaveBeenCalled()
  })

  it('email не подтверждён у провайдера → OAuthExchangeError (не логиним)', async () => {
    const f = makeFetchQueue([
      jsonRes(true, 200, { access_token: 'at-1' }),
      jsonRes(true, 200, { sub: 'sub-1', email: 'g@gmail.com', email_verified: false }),
    ])
    const { uc, signIn } = makeUc(f.fetchMock)
    const state = validState(uc)

    await expect(uc.execute({ code: 'x', state, stateCookie: state })).rejects.toBeInstanceOf(
      OAuthExchangeError,
    )
    expect(signIn).not.toHaveBeenCalled()
  })

  it('email отсутствует в userinfo → OAuthExchangeError', async () => {
    const f = makeFetchQueue([
      jsonRes(true, 200, { access_token: 'at-1' }),
      jsonRes(true, 200, { sub: 'sub-1' }),
    ])
    const { uc, signIn } = makeUc(f.fetchMock)
    const state = validState(uc)

    await expect(uc.execute({ code: 'x', state, stateCookie: state })).rejects.toBeInstanceOf(
      OAuthExchangeError,
    )
    expect(signIn).not.toHaveBeenCalled()
  })

  it('сеть недоступна (fetch бросил) → OAuthExchangeError, а не краш', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network unreachable in test')
    })
    const { uc, signIn } = makeUc(fetchMock)
    const state = validState(uc)

    await expect(uc.execute({ code: 'x', state, stateCookie: state })).rejects.toThrow(
      OAuthExchangeError,
    )
    expect(signIn).not.toHaveBeenCalled()
  })

  it('state не прошёл проверку → OAuthStateError ещё до fetch', async () => {
    const f = makeFetchQueue([])
    const { uc } = makeUc(f.fetchMock)

    await expect(
      uc.execute({ code: 'x', state: 'garbage.sig', stateCookie: 'garbage.sig' }),
    ).rejects.toBeInstanceOf(OAuthStateError)
    expect(f.calls).toHaveLength(0)
  })
})
