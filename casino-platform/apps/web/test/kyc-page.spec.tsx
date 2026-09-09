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
  useAuth: (sel?: (s: unknown) => unknown) =>
    sel ? sel({ user: userMock }) : { user: userMock },
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

describe('GAP-36/44: страница KYC — лимит из API', () => {
  it('показывает остаток из API (limit_remaining/limit_currency) без пересчёта', async () => {
    kycMock.mockResolvedValue({
      status: 'not_submitted',
      limit_remaining: '5000',
      limit_currency: 'RUB',
      deposit_limit_rub: '5000',
    })
    renderPage()
    // остаток — как отдал API (limit_remaining + limit_currency), без пересчёта;
    // «…» = query ещё pending — ждём замены на фактическое значение из API
    const deepest = (marker: string) => (_: unknown, el: Element | null): boolean => {
      if (!el || !el.textContent) {
        return false
      }
      const own = el.textContent.includes(marker) && el.textContent.includes('5 000')
      if (!own) {
        return false
      }
      // самый глубокий узел: дети не содержат marker (иначе матчились бы предки)
      return !Array.from(el.children).some((ch) => ch.textContent?.includes(marker))
    }
    const rest = await screen.findByText(deepest('Остаток лимита без KYC'), undefined, { timeout: 3000 })
    expect(rest.textContent).toContain('5 000')
  })

  it('исчерпан: красный блок + CTA «Пройти верификацию» на анкор формы', async () => {
    kycMock.mockResolvedValue({
      status: 'not_submitted',
      limit_remaining: '0',
      limit_currency: 'RUB',
      deposit_limit_rub: '5000',
    })
    renderPage()
    const cta = await screen.findByRole('link', { name: /Пройти верификацию/i })
    expect(cta.getAttribute('href')).toBe('#kyc-form')
    expect(screen.getByText(/Лимит пополнений исчерпан/i)).toBeTruthy()
  })

  it('approved: «Лимит снят», блока исчерпания нет', async () => {
    kycMock.mockResolvedValue({
      status: 'approved',
      limit_remaining: '0',
      limit_currency: 'RUB',
      deposit_limit_rub: '5000',
    })
    renderPage()
    await waitFor(() => expect(screen.getByText(/Лимит снят/i)).toBeTruthy())
    expect(screen.queryByText(/Лимит пополнений исчерпан/i)).toBeNull()
  })
})
