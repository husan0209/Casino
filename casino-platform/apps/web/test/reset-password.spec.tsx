import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Страница «Новый пароль» по ссылке из письма. Повтор пароля здесь обязателен:
 * прежнего пароля пользователь не помнит, ссылки сброса одноразовые, и опечатка
 * в единственном поле означала бы «задал пароль, которого не знаю». Проверка
 * клиентская и зеркалит `ResetPasswordSchema` (мин. 8 + цифра), чтобы не
 * сжигать токен отказом API.
 */

const router = vi.hoisted(() => ({ push: vi.fn() }))
const search = vi.hoisted(() => new URLSearchParams('token=TOKEN1234567890'))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
const api = vi.hoisted(() => ({
  apiPost: vi.fn(),
  errText: (e: unknown): string => (e instanceof Error ? e.message : String(e)),
}))

vi.mock('next/navigation', () => ({
  useRouter: (): typeof router => router,
  useSearchParams: (): URLSearchParams => search,
}))
vi.mock('@/lib/api', () => api)
vi.mock('@/components/ui/toaster', () => ({ toast }))

import ResetPasswordPage from '@/app/(auth)/reset-password/page'

const fields = (): { pw: HTMLElement; repeat: HTMLElement } => ({
  pw: screen.getByLabelText('Новый пароль'),
  repeat: screen.getByLabelText('Повторите пароль'),
})

function type(value: string, repeat = value): void {
  const { pw, repeat: repeatEl } = fields()
  fireEvent.change(pw, { target: { value } })
  fireEvent.change(repeatEl, { target: { value: repeat } })
}

beforeEach(() => {
  api.apiPost.mockReset()
  router.push.mockReset()
  toast.success.mockReset()
  toast.error.mockReset()
})

afterEach(cleanup)

describe('/reset-password', () => {
  it('повтор пароля есть и он обязателен', () => {
    render(<ResetPasswordPage />)

    expect(fields().repeat).toBeTruthy()
    expect((fields().repeat as HTMLInputElement).required).toBe(true)
  })

  it('пароли не совпадают — запрос не уходит, ошибка под полем', () => {
    render(<ResetPasswordPage />)
    type('Str0ngPass', 'Str0ngPasx')
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(screen.getByRole('alert').textContent).toBe('Пароли не совпадают')
    expect(api.apiPost).not.toHaveBeenCalled()
  })

  it('короткий пароль отсекается до отправки тем же правилом, что и API', () => {
    render(<ResetPasswordPage />)
    type('a1b2')
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(screen.getByRole('alert').textContent).toBe('Минимум 8 символов')
    expect(api.apiPost).not.toHaveBeenCalled()
  })

  it('без цифры — та же ветка', () => {
    render(<ResetPasswordPage />)
    type('abcdefgh')
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(screen.getByRole('alert').textContent).toBe('Пароль должен содержать минимум 1 цифру')
    expect(api.apiPost).not.toHaveBeenCalled()
  })

  it('совпавший валидный пароль уходит один раз с токеном из ссылки', async () => {
    api.apiPost.mockResolvedValue({ success: true })
    render(<ResetPasswordPage />)
    type('Str0ngPass')
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(api.apiPost).toHaveBeenCalledTimes(1))
    expect(api.apiPost).toHaveBeenCalledWith('/auth/reset-password', {
      token: 'TOKEN1234567890',
      new_password: 'Str0ngPass',
    })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(toast.success).toHaveBeenCalledWith('Пароль изменён')
  })

  /**
   * Шкала та же, что в шторке входа: две копии разъехались бы при первой правке
   * правила, поэтому она вынесена в общий компонент.
   */
  it('показывает индикатор силы, как форма регистрации', () => {
    render(<ResetPasswordPage />)
    expect(screen.queryByTestId('password-strength')).toBeNull()

    fireEvent.change(fields().pw, { target: { value: 'Str0ngPass' } })

    expect(screen.getByTestId('password-strength').textContent).toContain('Надёжный пароль')
  })
})
