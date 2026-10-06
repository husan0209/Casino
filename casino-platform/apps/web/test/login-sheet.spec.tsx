import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * §5: вход и регистрация — один лист. Режим регистрации равноправен входу:
 * лист открывается в режиме, который попросили (шапка / редиректы /register),
 * 18+ блокирует submit до согласия, реферальный код из ?ref= едет тихо,
 * affiliate — из AffiliateCodeCapture (localStorage после /go/<code>).
 * Отдельных страниц /login и /register больше нет.
 */

const uiState = vi.hoisted(() => ({
  loginSheet: true,
  loginSheetMode: 'register' as 'login' | 'register',
  closeLogin: vi.fn(),
  pendingGameSlug: null as string | null,
}))

const loginMock = vi.hoisted(() => vi.fn())
const registerMock = vi.hoisted(() => vi.fn())
const setSessionMock = vi.hoisted(() => vi.fn())
const setAccessTokenMock = vi.hoisted(() => vi.fn())
const exchangeTelegramMock = vi.hoisted(() => vi.fn())
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
/** TelegramLoginWidget — заглушка: запоминает onAuth, чтобы тест дёрнул вход. */
const telegramCapture = vi.hoisted(() => ({
  onAuth: null as ((payload: unknown) => void) | null,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}))

vi.mock('@/stores/ui', () => ({
  useUIStore: Object.assign(() => uiState, { getState: () => uiState }),
}))

vi.mock('@/stores/auth', () => ({
  useAuth: () => ({ login: loginMock, register: registerMock, setSession: setSessionMock }),
}))

vi.mock('@/lib/api', () => ({
  errCode: () => undefined,
  errText: () => 'Ошибка',
  setAccessToken: setAccessTokenMock,
}))

vi.mock('@/components/auth/CaptchaField', () => ({
  CaptchaField: () => null,
}))

vi.mock('@/components/auth/oauth', () => ({
  GOOGLE_CLIENT_ID: undefined,
  OAUTH_BUTTON_CLASS: '',
  GoogleMark: () => null,
  TelegramMark: () => null,
  startGoogleOAuth: vi.fn(),
  TELEGRAM_BOT_NAME: 'test_bot',
  TelegramLoginWidget: ({ onAuth }: { onAuth: (payload: unknown) => void }) => {
    telegramCapture.onAuth = onAuth
    return null
  },
  exchangeTelegramAuth: exchangeTelegramMock,
}))

vi.mock('@/components/affiliate/AffiliateCodeCapture', () => ({
  getAffiliateCode: () => 'AFF1',
}))

vi.mock('@/components/ui/toaster', () => ({
  toast: toastMock,
}))

import { LoginSheet } from '@/components/auth/LoginSheet'

import { LEGAL_DOCUMENT_VERSIONS } from '@casino/shared-types'

beforeEach(() => {
  loginMock.mockReset()
  registerMock.mockReset()
  setSessionMock.mockReset()
  setAccessTokenMock.mockReset()
  exchangeTelegramMock.mockReset()
  toastMock.success.mockReset()
  toastMock.error.mockReset()
  telegramCapture.onAuth = null
  uiState.closeLogin.mockReset()
  uiState.loginSheet = true
  uiState.loginSheetMode = 'register'
  uiState.pendingGameSlug = null
  window.history.replaceState(null, '', '/?ref=REF9')
})

afterEach(cleanup)

describe('§5: LoginSheet — вход и регистрация в одном листе', () => {
  it('открывается в режиме, который попросили (store loginSheetMode)', () => {
    render(<LoginSheet />)
    expect(screen.getByRole('heading', { name: 'Создать аккаунт' })).toBeTruthy()
    expect(screen.getByPlaceholderText('Мин. 8 символов')).toBeTruthy()
  })

  it('в режиме входа — заголовок входа и «запомнить меня» вместо 18+', () => {
    uiState.loginSheetMode = 'login'
    render(<LoginSheet />)
    expect(screen.getByRole('heading', { name: 'Войдите, чтобы играть' })).toBeTruthy()
    expect(screen.getByText('Запомнить меня')).toBeTruthy()
    expect(screen.queryByPlaceholderText('Мин. 8 символов')).toBeNull()
  })

  it('регистрация: без 18+ submit заблокирован, с ним — register с тихим ref и affiliate', async () => {
    registerMock.mockResolvedValue(undefined)
    render(<LoginSheet />)
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 't@t.t' },
    })
    fireEvent.change(screen.getByPlaceholderText('Мин. 8 символов'), {
      target: { value: 'Str0ng!pass' },
    })
    const submit = screen.getByRole('button', { name: 'Создать аккаунт' })
    expect((submit as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('checkbox'))
    expect((submit as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(submit)

    await waitFor(() => {
      // termsVersion внутри объекта — лист передаёт ту же версию, что и страница
      // /legal/terms (GAP-71); сервер сверяет её со своим реестром.
      expect(registerMock).toHaveBeenCalledWith('t@t.t', 'Str0ng!pass', {
        referral: 'REF9',
        affiliate: 'AFF1',
        termsVersion: LEGAL_DOCUMENT_VERSIONS.terms,
      })
    })
    expect(uiState.closeLogin).toHaveBeenCalled()
  })

  it('индикатор силы пароля появляется по мере ввода', () => {
    render(<LoginSheet />)
    expect(screen.queryByText('Надёжный пароль')).toBeNull()
    fireEvent.change(screen.getByPlaceholderText('Мин. 8 символов'), {
      target: { value: 'Str0ng!pass' },
    })
    expect(screen.getByText('Надёжный пароль')).toBeTruthy()
  })

  it('UC-AUTH-09: вход через Telegram — обмен на сессию с тихим ref, setSession и закрытие листа', async () => {
    uiState.loginSheetMode = 'login'
    exchangeTelegramMock.mockResolvedValue({
      accessToken: 'tg-token',
      user: { id: 'u9', email: null, role: 'user' },
    })
    render(<LoginSheet />)

    expect(telegramCapture.onAuth).toBeTypeOf('function')
    await act(async () => {
      telegramCapture.onAuth?.({ id: 42, auth_date: 1690000000, hash: 'HASH1' })
    })

    await waitFor(() => {
      // referral из ?ref= едет в обмен так же, как в email-регистрации.
      expect(exchangeTelegramMock).toHaveBeenCalledWith(
        { id: 42, auth_date: 1690000000, hash: 'HASH1' },
        'REF9',
      )
    })
    expect(setAccessTokenMock).toHaveBeenCalledWith('tg-token')
    expect(setSessionMock).toHaveBeenCalledWith('tg-token', { id: 'u9', email: null, role: 'user' })
    expect(toastMock.success).toHaveBeenCalled()
    expect(uiState.closeLogin).toHaveBeenCalled()
  })

  it('UC-AUTH-09: ошибка обмена Telegram — toast и лист остаётся открытым', async () => {
    uiState.loginSheetMode = 'login'
    exchangeTelegramMock.mockRejectedValue(new Error('подпись Telegram не совпадает'))
    render(<LoginSheet />)

    await act(async () => {
      telegramCapture.onAuth?.({ id: 42, auth_date: 1690000000, hash: 'BAD' })
    })

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith('Ошибка')
    })
    expect(uiState.closeLogin).not.toHaveBeenCalled()
  })
})
