import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * GAP-73 (Terms §21): диалог повторного акцепта. Проверяет не внешний вид, а
 * два правила, ради которых гейт и затевался:
 *  - пока сервер не сказал `terms_reaccept_required`, диалога нет;
 *  - согласие — активное действие: кнопка заблокирована, пока чекбокс снят,
 *    и только после подтверждения уходит запрос на запись новой строки журнала.
 */

const authState = vi.hoisted(() => ({
  termsReacceptRequired: false,
  acceptTerms: vi.fn(),
}))

vi.mock('@/stores/auth', () => ({
  useAuth: (selector: (state: typeof authState) => unknown) => selector(authState),
}))

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock('@/components/ui/toaster', () => ({ toast: toastMock }))

vi.mock('@/lib/api', () => ({ errText: () => 'сервер недоступен' }))

import { TermsReacceptDialog } from '@/components/legal/TermsReacceptDialog'

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  authState.termsReacceptRequired = false
  authState.acceptTerms.mockReset()
  toastMock.success.mockReset()
  toastMock.error.mockReset()
})

describe('TermsReacceptDialog', () => {
  it('без сигнала с сервера диалога нет', () => {
    render(<TermsReacceptDialog />)

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('с сигналом — диалог, ссылки на документы и заблокированная кнопка', () => {
    authState.termsReacceptRequired = true
    render(<TermsReacceptDialog />)

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText(/Условия использования обновились/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Условия использования' }).getAttribute('href')).toBe(
      '/legal/terms',
    )
    expect(
      screen.getByRole('link', { name: 'Политика конфиденциальности' }).getAttribute('href'),
    ).toBe('/legal/privacy')
    const submit = screen.getByRole('button', { name: /Принять условия/ })
    expect((submit as HTMLButtonElement).disabled).toBe(true)
  })

  it('согласие отмечено — кнопка активна и шлёт подтверждение', async () => {
    authState.termsReacceptRequired = true
    authState.acceptTerms.mockResolvedValue(undefined)
    render(<TermsReacceptDialog />)

    fireEvent.click(screen.getByRole('checkbox'))
    const submit = screen.getByRole('button', { name: /Принять условия/ })
    expect((submit as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(submit)

    await waitFor(() => expect(authState.acceptTerms).toHaveBeenCalledTimes(1))
    expect(toastMock.success).toHaveBeenCalled()
  })

  it('ошибка записи не притворяется успехом', async () => {
    authState.termsReacceptRequired = true
    authState.acceptTerms.mockRejectedValue(new Error('boom'))
    render(<TermsReacceptDialog />)

    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /Принять условия/ }))

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('сервер недоступен'))
    expect(toastMock.success).not.toHaveBeenCalled()
  })
})
