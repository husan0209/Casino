import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * UC-AUTH-09: экран подтверждения на /auth/telegram/callback. Telegram своего
 * «продолжить как …» не показывает (свой экран — вход по номеру телефона), так
 * что спрашиваем игрока сами:
 * - сначала только проверка подписи — POST /auth/telegram/preview, он не выдаёт
 *   сессию и не создаёт пользователя;
 * - POST /auth/telegram уходит строго по кнопке «Продолжить»;
 * - «Отмена» не делает ни одного запроса на вход;
 * - заголовок различает знакомого игрока («Вход…») и нового («Регистрация…»);
 * - id/auth_date/hash выметаются из адресной строки: это готовый токен входа.
 */

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
const openLogin = vi.hoisted(() => vi.fn())
const setSession = vi.hoisted(() => vi.fn())
const setAccessToken = vi.hoisted(() => vi.fn())
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
const api = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  errText: (err: unknown): string => (err instanceof Error ? err.message : String(err)),
  setAccessToken,
}))

vi.mock('next/navigation', () => ({ useRouter: (): typeof router => router }))
vi.mock('@/lib/api', () => api)
vi.mock('@/components/ui/toaster', () => ({ toast }))
vi.mock('@/stores/ui', () => ({
  useUIStore: Object.assign(vi.fn(), { getState: () => ({ openLogin }) }),
}))
vi.mock('@/stores/auth', () => ({
  // Селектор применяем как zustand: лист входа вызывает useAuth(s => s.setSession).
  useAuth: (selector: (s: { setSession: ReturnType<typeof vi.fn> }) => unknown): unknown =>
    selector({ setSession }),
}))

import TelegramCallbackPage from '@/app/(auth)/auth/telegram/callback/page'

const PREVIEW_KNOWN = {
  displayName: 'Иван Петров',
  username: 'ivan',
  photoUrl: null,
  accountExists: true,
}

/** Колбэк виджета: поля пользователя в query + тихий ?ref=. */
function atCallback(query = 'id=42&auth_date=1690000000&hash=HASH1&ref=REF9'): void {
  window.history.replaceState(null, '', `/auth/telegram/callback?${query}`)
}

beforeEach(() => {
  api.apiGet.mockReset()
  api.apiPost.mockReset()
  router.push.mockReset()
  router.replace.mockReset()
  openLogin.mockReset()
  setSession.mockReset()
  setAccessToken.mockReset()
  toast.success.mockReset()
  toast.error.mockReset()
})

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

describe('/auth/telegram/callback', () => {
  it('сначала проверяет подпись и показывает аккаунт, не входя', async () => {
    atCallback()
    api.apiPost.mockResolvedValue(PREVIEW_KNOWN)

    render(<TelegramCallbackPage />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Продолжить' })).toBeTruthy())
    expect(api.apiPost.mock.calls[0]![0]).toBe('/auth/telegram/preview')
    expect(screen.getByRole('heading', { name: 'Вход через Telegram' })).toBeTruthy()
    expect(screen.getByText('Иван Петров')).toBeTruthy()
    expect(screen.getByText('@ivan')).toBeTruthy()
  })

  it('обменивает данные на сессию только по «Продолжить» и уносит в профиль', async () => {
    atCallback()
    api.apiPost
      .mockResolvedValueOnce(PREVIEW_KNOWN)
      .mockResolvedValueOnce({ accessToken: 'tok', user: { id: 'u1' } })

    render(<TelegramCallbackPage />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Продолжить' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }))

    await waitFor(() => expect(setSession).toHaveBeenCalledWith('tok', { id: 'u1' }))
    expect(api.apiPost.mock.calls[1]![0]).toBe('/auth/telegram')
    // Реферальный код переживает экран подтверждения — он едет в обмен.
    expect(api.apiPost.mock.calls[1]![1]).toMatchObject({ referral_code: 'REF9' })
    expect(setAccessToken).toHaveBeenCalledWith('tok')
  })

  it('«Отмена» не отправляет ни одного запроса на вход', async () => {
    atCallback()
    api.apiPost.mockResolvedValue(PREVIEW_KNOWN)

    render(<TelegramCallbackPage />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Отмена' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))

    expect(api.apiPost).toHaveBeenCalledTimes(1)
    expect(openLogin).toHaveBeenCalled()
    expect(router.replace).toHaveBeenCalledWith('/')
  })

  it('незнакомый Telegram — экран регистрации, а не входа', async () => {
    atCallback()
    api.apiPost.mockResolvedValue({ ...PREVIEW_KNOWN, accountExists: false })

    render(<TelegramCallbackPage />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Продолжить' })).toBeTruthy())

    expect(screen.getByRole('heading', { name: 'Регистрация через Telegram' })).toBeTruthy()
    expect(screen.getByText(/создадим новый/)).toBeTruthy()
  })

  it('чистит реквизиты входа из адресной строки, оставляя ?ref=', async () => {
    atCallback()
    api.apiPost.mockResolvedValue(PREVIEW_KNOWN)

    render(<TelegramCallbackPage />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Продолжить' })).toBeTruthy())

    expect(window.location.pathname).toBe('/auth/telegram/callback')
    expect(window.location.search).toBe('?ref=REF9')
  })

  it('без полей виджета — ошибка и ни одного запроса', async () => {
    atCallback('foo=1')
    api.apiPost.mockResolvedValue(PREVIEW_KNOWN)

    render(<TelegramCallbackPage />)
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Не удалось войти через Telegram' })).toBeTruthy(),
    )

    expect(api.apiPost).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Вернуться ко входу' })).toBeTruthy()
  })

  it('просроченная или поддельная подпись отсекается до обмена', async () => {
    atCallback()
    api.apiPost.mockRejectedValue(new Error('данные виджета просрочены'))

    render(<TelegramCallbackPage />)
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Не удалось войти через Telegram' })).toBeTruthy(),
    )

    expect(api.apiPost).toHaveBeenCalledTimes(1)
    expect(screen.getByText('данные виджета просрочены')).toBeTruthy()
  })
})
