import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * GAP-44 stage 2 + GAP-36: DOM-тесты DepositSheet.
 * Закрепляют критерии GAP-36, которые типы не ловят:
 *   1) остаток лимита — ИЗ API (limit_remaining в валюте шита), без пересчёта;
 *   2) при исчерпании CTA = «Лимит исчерпан — пройти верификацию» и ведёт
 *      на /kyc ДО отправки формы (не 422 после);
 *   3) approved → лимит снят, обычная кнопка «Пополнить».
 */

const pushMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn() }),
}))

const kycMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api/kyc.api', () => ({
  getKycStatus: kycMock,
}))

const depositMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api/wallet.api', () => ({
  createFiatDeposit: depositMock,
  fetchBalances: vi.fn(),
  pollDepositStatus: vi.fn(),
  setActiveCurrency: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  errText: (e: unknown): string => String(e),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}))

vi.mock('@/components/ui/toaster', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}))

vi.mock('@/components/wallet/DepositReturnHandler', () => ({
  saveDepositContext: vi.fn(),
}))

vi.mock('@/stores/ui', () => ({
  useUIStore: (sel?: (s: unknown) => unknown) =>
    sel
      ? sel({
          depositSheet: true,
          closeDeposit: vi.fn(),
          depositCurrency: 'RUB',
          pendingGameSlug: null,
        })
      : {
          depositSheet: true,
          closeDeposit: vi.fn(),
          depositCurrency: 'RUB',
          pendingGameSlug: null,
        },
}))

const geoConfig = {
  activeCurrency: 'RUB',
  depositPresets: ['1000', '2000', '5000', '10000'],
  paymentMethods: [{ id: 'card', label: 'Карта' }],
  cryptoMethods: [{ id: 'usdt', label: 'USDT TRC20', currency: 'USDT_TRC20' }],
}

vi.mock('@/stores/geo', () => ({
  useGeoStore: (sel?: (s: unknown) => unknown) =>
    sel
      ? sel({ config: geoConfig, load: vi.fn() })
      : { config: geoConfig, load: vi.fn() },
}))

vi.mock('@/stores/wallet', () => ({
  useWalletStore: (sel?: (s: unknown) => unknown) =>
    sel
      ? sel({ activeCurrency: 'RUB', setActiveCurrency: vi.fn() })
      : { activeCurrency: 'RUB', setActiveCurrency: vi.fn() },
}))

const userMock = vi.hoisted(() => ({ id: 'u1', email: 't@t.t', role: 'user' }))

vi.mock('@/stores/auth', () => ({
  useAuth: (sel?: (s: unknown) => unknown) =>
    sel ? sel({ user: userMock }) : { user: userMock },
  useAuthStore: { getState: () => ({ user: userMock }) },
}))

import { DepositSheet } from '@/components/wallet/DepositSheet'

function renderSheet(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <DepositSheet />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  pushMock.mockReset()
  depositMock.mockReset()
})

afterEach(cleanup)

describe('GAP-36/44: DepositSheet — KYC-лимит из API', () => {
  it('показывает остаток лимита из API в валюте шита (без пересчёта)', async () => {
    kycMock.mockResolvedValue({
      status: 'not_submitted',
      limit_remaining: '5000',
      limit_currency: 'RUB',
      deposit_limit_rub: '5000',
    })
    renderSheet()
    // значение — как отдал API, без клиентской арифметики; пресет-кнопки «5 000 ₽»
    // не считаем — берём именно параграф остатка целиком (текст в двух узлах:
    // «Остаток лимита: » + «5 000 ₽»), матчим самый глубокий узел с маркером
    const deepest = (_: unknown, el: Element | null): boolean => {
      if (!el?.textContent?.includes('Остаток лимита') || !el.textContent.includes('5 000')) {
        return false
      }
      return !Array.from(el.children).some((ch) => ch.textContent?.includes('Остаток лимита'))
    }
    const rest = await screen.findByText(deepest, undefined, { timeout: 3000 })
    expect(rest.textContent).toContain('5 000')
  })

  it('исчерпан: CTA «Лимит исчерпан» и роут на /kyc ДО отправки формы', async () => {
    kycMock.mockResolvedValue({
      status: 'not_submitted',
      limit_remaining: '0',
      limit_currency: 'RUB',
      deposit_limit_rub: '5000',
    })
    renderSheet()
    const cta = await screen.findByRole('button', {
      name: /Лимит исчерпан — пройти верификацию/i,
    })
    cta.click()
    expect(depositMock).not.toHaveBeenCalled()
    expect(pushMock).toHaveBeenCalledWith('/kyc')
  })

  it('approved: лимит снят — обычная кнопка «Пополнить»', async () => {
    kycMock.mockResolvedValue({
      status: 'approved',
      limit_remaining: '0',
      limit_currency: 'RUB',
      deposit_limit_rub: '5000',
    })
    renderSheet()
    const cta = await screen.findByRole('button', { name: 'Пополнить' })
    cta.click()
    expect(pushMock).not.toHaveBeenCalledWith('/kyc')
  })
})
