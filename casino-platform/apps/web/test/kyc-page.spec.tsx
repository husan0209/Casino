import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * GAP-44 stage 2 + GAP-36: DOM-тесты страницы KYC.
 * Критерий GAP-36 на странице: цифра порога берётся из API (withdraw_*), на
 * клиенте курсы и суммы не пересчитываются.
 *
 * Что изменилось 2026-10-07 (решение владельца): порог переехал с пополнения на
 * вывод и он суммарный, поэтому страница показывает «до сколько можно вывести
 * без верификации» и уже выведенное, а не «остаток лимита пополнений».
 */

const kycMock = vi.hoisted(() => vi.fn())

/** Фикс ответа GET /kyc/status: RUB-порог 5 000, выведено 1 200. */
const kycPayload = (over: Record<string, string>): Record<string, string> => ({
  status: 'not_submitted',
  withdraw_limit_rub: '5000',
  withdrawn_rub: '1200',
  withdraw_remaining_rub: '3800',
  withdraw_remaining: '3800',
  withdraw_currency: 'RUB',
  ...over,
})

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

describe('Страница KYC — верификация нужна для вывода сверх порога, не для пополнения', () => {
  // Раньше этот блок проверял обратное: страница показывала «Остаток лимита без
  // KYC … из 5000 ₽ суммарных пополнений» и красную карточку «Лимит пополнений
  // исчерпан». Шлюз на пополнении снят 2026-10-07 (решение владельца): верификация
  // относится к выводу.

  it('показывает порог вывода из API и уже выведенное, плашки про пополнение — нет', async () => {
    kycMock.mockResolvedValue(kycPayload({}))
    renderPage()
    // Матчим именно загруженную строку: пока GET /kyc/status не ответился, на
    // экране fallback без числа, и общий матчер «Пополнять счёт можно…» ловил бы
    // именно его (тест проходил бы, не увидев порога).
    const line = await screen.findByText(/Вывод до 5 000 ₽/, undefined, { timeout: 3000 })
    expect(line.textContent).toContain('тоже без неё')
    expect(screen.queryByText(/Остаток лимита без KYC/i)).toBeNull()
    expect(screen.queryByText(/Лимит пополнений исчерпан/i)).toBeNull()
    // Числа из API, без клиентской арифметики: 5 000 − 1 200 = 3 800 отдаёт бэк.
    const card = await screen.findByText(/Без верификации доступно ещё/i, undefined, {
      timeout: 3000,
    })
    expect(card.textContent).toContain('3 800')
    expect(card.textContent).toContain('1 200')
  })

  it('пока ответ не пришёл — строка без числа, и она не обещает правило', async () => {
    let resolveKyc: (value: Record<string, string>) => void = () => undefined
    kycMock.mockImplementation(() => new Promise((resolve) => (resolveKyc = resolve)))
    renderPage()
    expect(await screen.findByText(/Вывод сверх порога — после неё/i)).toBeTruthy()
    resolveKyc(kycPayload({}))
    expect(await screen.findByText(/Вывод до 5 000 ₽/, undefined, { timeout: 3000 })).toBeTruthy()
  })

  it('approved — про вывод без лимита по сумме, карточки порога нет', async () => {
    kycMock.mockResolvedValue(kycPayload({ status: 'approved' }))
    renderPage()
    await waitFor(() => expect(screen.getByText(/вывод средств доступен/i)).toBeTruthy())
    expect(screen.queryByText(/Лимит снят/i)).toBeNull()
    expect(screen.queryByText(/Без верификации доступно ещё/i)).toBeNull()
  })

  /**
   * Аудит контрактов 2026-09-26: GetKycStatusUseCase отдаёт причину отказа в
   * поле rejectionReason (spread строки репозитория). Раньше страница читала
   * rejection_reason — такого ключа API не отдаёт, и причина не показывалась.
   */
  it('rejected: причина отказа показывается из API-поля rejectionReason', async () => {
    kycMock.mockResolvedValue(
      kycPayload({ status: 'rejected', rejectionReason: 'Документ нечитаем' }),
    )
    renderPage()
    const reason = await screen.findByText(/Причина:/, undefined, { timeout: 3000 })
    expect(reason.textContent).toContain('Документ нечитаем')
  })
})
