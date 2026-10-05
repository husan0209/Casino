import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}))

vi.mock('@/stores/ui', () => ({
  useUIStore: Object.assign(() => uiState, { getState: () => uiState }),
}))

vi.mock('@/stores/auth', () => ({
  useAuth: () => ({ login: loginMock, register: registerMock }),
}))

vi.mock('@/lib/api', () => ({
  errCode: () => undefined,
  errText: () => 'Ошибка',
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
}))

vi.mock('@/components/affiliate/AffiliateCodeCapture', () => ({
  getAffiliateCode: () => 'AFF1',
}))

vi.mock('@/components/ui/toaster', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import { LoginSheet } from '@/components/auth/LoginSheet'

import { LEGAL_DOCUMENT_VERSIONS } from '@casino/shared-types'

beforeEach(() => {
  loginMock.mockReset()
  registerMock.mockReset()
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
})
