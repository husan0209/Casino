/**
 * GAP-73 (Terms §21): откуда берётся флаг повторного акцепта.
 *
 * Диалог показывается по `termsReacceptRequired`, поэтому важно, что этот флаг
 * ставится на ЛЮБОМ пути, где возникает сессия. Ловим два регресса:
 *  - флаг ставится из ответа `/auth/login` (иначе гейт надо угадывать на фронте);
 *  - сессия из OAuth/подтверждения письма/reload тоже получает проверку, иначе
 *    игрок, вошедший не паролем, пропустил бы требование подтвердить новую
 *    редакцию — а Terms §21 обещает его именно при входе.
 * Отказ проверки не должен ронять рабочую сессию.
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

const webUser = { id: 'u1', email: 'player@example.com', role: 'user' }
const meDto = { user: webUser, profile: null, settings: null, kycStatus: 'not_started' }

beforeEach(() => {
  mockedApi.get.mockReset()
  mockedApi.post.mockReset()
  mockedApi.patch.mockReset()
  mockedApi.delete.mockReset()
  useAuth.setState({ token: null, user: null, hydrated: false, termsReacceptRequired: false })
})

/** Развязать общий mock get по пути: /users/me и гейт-проверка отвечают разное. */
function routeGet(handler: (url: string) => unknown): void {
  mockedApi.get.mockImplementation((url: string) =>
    Promise.resolve({ data: { data: handler(url) } }),
  )
}

describe('auth store: гейт повторного акцепта', () => {
  it('login берёт флаг из ответа сервера, а не вычисляет его на фронте', async () => {
    mockedApi.post.mockResolvedValue({
      data: { data: { accessToken: 'jwt-1', user: webUser, terms_reaccept_required: true } },
    })

    await useAuth.getState().login('player@example.com', 'secret123')

    expect(useAuth.getState().token).toBe('jwt-1')
    expect(useAuth.getState().termsReacceptRequired).toBe(true)
  })

  it('вход без сигнала гейта остаётся без проверки — флаг снят', async () => {
    mockedApi.post.mockResolvedValue({
      data: { data: { accessToken: 'jwt-2', user: webUser, terms_reaccept_required: false } },
    })

    await useAuth.getState().login('player@example.com', 'secret123')

    expect(useAuth.getState().termsReacceptRequired).toBe(false)
    expect(mockedApi.get).not.toHaveBeenCalled()
  })

  it('OAuth-колбэк (setSession) перечитывает гейт', async () => {
    routeGet((url) => (url === '/auth/terms-acceptances' ? { reacceptRequired: true } : meDto.user))

    useAuth.getState().setSession('jwt-3', webUser)

    await vi.waitFor(() => expect(useAuth.getState().termsReacceptRequired).toBe(true))
    // apiGet передаёт вторым аргументом { params } — сверяем только путь.
    expect(mockedApi.get.mock.calls[0]?.[0]).toBe('/auth/terms-acceptances')
  })

  it('подтверждение письма (setAuth) тоже перечитывает гейт', async () => {
    routeGet((url) => (url === '/auth/terms-acceptances' ? { reacceptRequired: true } : meDto.user))

    useAuth.getState().setAuth(webUser, 'jwt-4')

    await vi.waitFor(() => expect(useAuth.getState().termsReacceptRequired).toBe(true))
  })

  it('hydrate после reload перечитывает гейт для восстановленной сессии', async () => {
    mockedApi.post.mockResolvedValue({ data: { data: { accessToken: 'jwt-5' } } })
    routeGet((url) => (url === '/auth/terms-acceptances' ? { reacceptRequired: true } : meDto))

    await useAuth.getState().hydrate()

    await vi.waitFor(() => expect(useAuth.getState().termsReacceptRequired).toBe(true))
  })

  it('отказ гейт-проверки не разлогинивает: сессия и флаг остаются как были', async () => {
    mockedApi.post.mockResolvedValue({ data: { data: { accessToken: 'jwt-6' } } })
    routeGet((url) => (url === '/auth/terms-acceptances' ? { reacceptRequired: false } : meDto))
    useAuth.getState().setSession('jwt-6', webUser)
    await vi.waitFor(() => expect(mockedApi.get).toHaveBeenCalled())

    mockedApi.get.mockRejectedValue(new Error('503'))
    useAuth.getState().setSession('jwt-7', webUser)
    await vi.waitFor(() => expect(mockedApi.get).toHaveBeenCalledTimes(2))

    expect(useAuth.getState().token).toBe('jwt-7')
    expect(useAuth.getState().termsReacceptRequired).toBe(false)
  })

  it('logout снимает флаг вместе с сессией', async () => {
    mockedApi.post.mockResolvedValue({ data: { data: {} } })
    useAuth.setState({ token: 'jwt-8', user: webUser, termsReacceptRequired: true })

    useAuth.getState().logout()

    expect(useAuth.getState().token).toBeNull()
    expect(useAuth.getState().termsReacceptRequired).toBe(false)
  })
})
