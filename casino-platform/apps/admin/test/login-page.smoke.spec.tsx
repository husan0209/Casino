import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * GAP-44 stage 2: smoke-тест логина админки.
 * Критичные для админки ветки:
 *   1) форма логина рендерится и сабмит вызывает store.login(email, password);
 *   2) при ошибке логина — ErrorBox с текстом errText (без редиректа).
 */

const replaceMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: replaceMock, back: vi.fn() }),
}))

const loginMock = vi.hoisted(() => vi.fn())

vi.mock('@/stores/auth', () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) =>
    sel
      ? sel({ token: null, admin: null, login: loginMock, logout: vi.fn() })
      : { token: null, admin: null, login: loginMock, logout: vi.fn() },
}))

vi.mock('@/lib/api', () => ({
  errText: (e: unknown): string =>
    (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
      ?.message ?? 'Ошибка',
  apiPost: vi.fn(),
  apiGet: vi.fn(),
}))

import LoginPage from '@/app/page'

beforeEach(() => {
  loginMock.mockReset()
  replaceMock.mockReset()
})

afterEach(cleanup)

describe('GAP-44: админка — smoke логина', () => {
  it('форма рендерится, сабмит вызывает login(email, password)', async () => {
    loginMock.mockResolvedValue(undefined)
    render(<LoginPage />)

    expect(screen.getByRole('heading', { name: /Admin Panel/i })).toBeTruthy()
    const form = document.querySelector('form') as HTMLFormElement

    const inputs = form.querySelectorAll('input')
    fireEvent.change(inputs[0]!, { target: { value: 'admin@casino.test' } })
    fireEvent.change(inputs[1]!, { target: { value: 'secret-pass' } })
    fireEvent.submit(form)

    await waitFor(() => expect(loginMock).toHaveBeenCalledWith('admin@casino.test', 'secret-pass'))
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/dashboard'))
  })

  it('ошибка логина: ErrorBox с текстом, без редиректа', async () => {
    loginMock.mockRejectedValue({
      response: { data: { error: { message: 'INVALID_CREDENTIALS' } } },
    })
    render(<LoginPage />)

    const form = document.querySelector('form') as HTMLFormElement
    const inputs = form.querySelectorAll('input')
    fireEvent.change(inputs[0]!, { target: { value: 'a@b.c' } })
    fireEvent.change(inputs[1]!, { target: { value: 'wrong' } })
    fireEvent.submit(form)

    await waitFor(() => expect(screen.getByText('INVALID_CREDENTIALS')).toBeTruthy())
    expect(replaceMock).not.toHaveBeenCalled()
  })
})
