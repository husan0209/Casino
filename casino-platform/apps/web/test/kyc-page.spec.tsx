import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * GAP-44 stage 2 + GAP-36: DOM-тесты страницы KYC.
 * Критерии GAP-36 (страница):
 *   1) остаток лимита — из API (limit_remaining + limit_currency), без пересчёта;
 *   2) при исчерпании — красный блок + CTA «Пройти верификацию» (анкор #kyc-form);
 *   3) approved — «Лимит снят» без блока исчерпания.
 */

const kycMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api/kyc.api', () => ({
  getKycStatus: kycMock,
}))

vi.mock('@/lib/api', () => ({
  errText: (e: unknown): string => String(e),
  apiPost: vi.fn(),
  apiGet: vi.fn(),
}))

vi.mock('@/components/ui/toaster', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}))

const userMock = vi.hoisted(() => ({ id: 'u1', email: 't@t.t', role: 'user' }))

vi.mock('@/stores/auth', () => ({
  useAuth: (sel?: (s: unknown) => unknown) => (sel ? sel({ user: userMock }) : { user: userMock }),
  useAuthStore: { getState: () => ({ user: userMock }) },
}))

import KycPage from '@/app/kyc/page'

function renderPage(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <KycPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  kycMock.mockReset()
})

afterEach(cleanup)

describe('Страница KYC — верификация нужна для вывода, не для пополнения', () => {
  // Раньше этот блок проверял обратное: страница показывала «Остаток лимита без
  // KYC … из 5000 ₽ суммарных пополнений» и красную карточку «Лимит пополнений
  // исчерпан». Шлюз снят 2026-10-07 (решение владельца): пополнять счёт можно
  // без верификации, верификация обязательна, чтобы вывести.

  it('не показывает остаток «лимита без KYC» и карточку исчерпания', async () => {
    kycMock.mockResolvedValue({
      status: 'not_submitted',
      limit_remaining: '0',
      limit_currency: 'RUB',
      deposit_limit_rub: '5000',
    })
    renderPage()
    await waitFor(() =>
      expect(screen.getByText(/Пополнять счёт можно без верификации/i)).toBeTruthy(),
    )
    expect(screen.queryByText(/Остаток лимита без KYC/i)).toBeNull()
    expect(screen.queryByText(/Лимит пополнений исчерпан/i)).toBeNull()
  })

  it('approved — про вывод, а не про «лимит снят»', async () => {
    kycMock.mockResolvedValue({
      status: 'approved',
      limit_remaining: '0',
      limit_currency: 'RUB',
      deposit_limit_rub: '5000',
    })
    renderPage()
    await waitFor(() => expect(screen.getByText(/вывод средств доступен/i)).toBeTruthy())
    expect(screen.queryByText(/Лимит снят/i)).toBeNull()
  })

  /**
   * Аудит контрактов 2026-09-26: GetKycStatusUseCase отдаёт причину отказа в
   * поле rejectionReason (spread строки репозитория). Раньше страница читала
   * rejection_reason — такого ключа API не отдаёт, и причина не показывалась.
   */
  it('rejected: причина отказа показывается из API-поля rejectionReason', async () => {
    kycMock.mockResolvedValue({
      status: 'rejected',
      rejectionReason: 'Документ нечитаем',
      limit_remaining: '5000',
      limit_currency: 'RUB',
      deposit_limit_rub: '5000',
    })
    renderPage()
    const reason = await screen.findByText(/Причина:/, undefined, { timeout: 3000 })
    expect(reason.textContent).toContain('Документ нечитаем')
  })
})
