/**
 * GAP-55 (ж): контракт тела POST /auth/login.
 *
 * Регресс, который легко сделать глазами: слать `captcha_token: ''` при обычном
 * входе (бэк тогда может счесть это «токен есть, но пустой») или не слать токен
 * вовсе после CAPTCHA_REQUIRED. Проверяем, что поле появляется только когда
 * непустое.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedApi = {
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}

vi.mock('axios', () => ({ default: { create: () => mockedApi } }))

const { useAuth } = await import('../src/stores/auth')

beforeEach(() => {
  mockedApi.get.mockReset()
  mockedApi.post.mockReset()
  mockedApi.patch.mockReset()
  mockedApi.delete.mockReset()
  mockedApi.post.mockResolvedValue({
    data: { data: { accessToken: 'a', user: { id: 'u1', email: 'a@b.c', role: 'user' } } },
  })
  useAuth.setState({ token: null, user: null })
})

function loginBody(): Record<string, unknown> {
  const call = mockedApi.post.mock.calls[0]
  return (call?.[1] ?? {}) as Record<string, unknown>
}

describe('GAP-55 auth store: captcha_token в запросе логина', () => {
  it('обычный вход — поля captcha_token нет вообще', async () => {
    await useAuth.getState().login('a@b.c', 'secret12')
    expect(loginBody()).toEqual({ email: 'a@b.c', password: 'secret12' })
  })

  it('пустой токен не отправляется (это «не прошло», а не «пытаемся проверить»)', async () => {
    await useAuth.getState().login('a@b.c', 'secret12', '')
    expect(loginBody()).not.toHaveProperty('captcha_token')
  })

  it('непустой токен уходит под именем captcha_token (контракт LoginSchema)', async () => {
    await useAuth.getState().login('a@b.c', 'secret12', 'turnstile-token')
    expect(loginBody()).toEqual({
      email: 'a@b.c',
      password: 'secret12',
      captcha_token: 'turnstile-token',
    })
  })

  it('успешный вход сохраняет токен и пользователя в store', async () => {
    await useAuth.getState().login('a@b.c', 'secret12')
    expect(useAuth.getState().token).toBe('a')
    expect(useAuth.getState().user?.email).toBe('a@b.c')
  })
})
