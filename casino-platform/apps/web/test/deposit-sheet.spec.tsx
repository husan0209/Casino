import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * GAP-44 stage 2 + GAP-36: DOM-тесты DepositSheet.
 * Закрепляют критерии GAP-36, которые типы не ловят:
 *   1) остаток лимита — ИЗ API (limit_remaining в валюте шита), без пересчёта;
 *   2) при исчерпании CTA = «Лимит исчерпан — пройти верификацию» и ведёт
 *      на /kyc ДО отправки формы (не 422 после);
 *   3) approved → лимит снят, обычная кнопка «Перейти к оплате».
 * GAP-59: с крипто-кошелька касса уходит в `/deposit/crypto`, а не в фиатную кассу.
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
const cryptoDepositMock = vi.hoisted(() => vi.fn())
const pollMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api/wallet.api', () => ({
  createFiatDeposit: depositMock,
  createCryptoDeposit: cryptoDepositMock,
  fetchBalances: vi.fn(),
  pollDepositStatus: pollMock,
  setActiveCurrency: setActiveCurrencyMock,
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

/** Состояния сторов меняются от теста к тесту (валюта шита/кошелька), отсюда обёртки. */
const uiState = vi.hoisted(() => ({
  depositSheet: true,
  depositCurrency: 'RUB' as string | undefined,
  pendingGameSlug: null as string | null,
}))

const closeDepositMock = vi.hoisted(() => vi.fn())

vi.mock('@/stores/ui', () => ({
  useUIStore: (sel?: (s: unknown) => unknown) => {
    const state = {
      depositSheet: uiState.depositSheet,
      closeDeposit: closeDepositMock,
      depositCurrency: uiState.depositCurrency,
      pendingGameSlug: uiState.pendingGameSlug,
      openWalletSwitcher: vi.fn(),
    }
    return sel ? sel(state) : state
  },
}))

const geoConfig = {
  activeCurrency: 'RUB',
  depositPresets: ['1000', '2000', '5000', '10000'],
  depositMin: '1000',
  paymentMethods: [{ id: 'card', label: 'Карта' }],
  cryptoMethods: [{ id: 'usdt', label: 'USDT TRC20', currency: 'USDT_TRC20' }],
}

vi.mock('@/stores/geo', () => ({
  useGeoStore: (sel?: (s: unknown) => unknown) =>
    sel ? sel({ config: geoConfig, load: vi.fn() }) : { config: geoConfig, load: vi.fn() },
}))

const walletState = vi.hoisted(() => ({
  activeCurrency: 'RUB',
  /** `null` = кошельков ещё нет (незалогиненный/первая загрузка). */
  active: null as { currency: string; available: string } | null,
}))

const setActiveCurrencyMock = vi.hoisted(() => vi.fn())

vi.mock('@/stores/wallet', () => ({
  useWalletStore: (sel?: (s: unknown) => unknown) => {
    const state = {
      activeCurrency: walletState.activeCurrency,
      setActiveCurrency: setActiveCurrencyMock,
      fetchWallets: vi.fn(),
      getActiveWallet: () => walletState.active ?? undefined,
    }
    return sel ? sel(state) : state
  },
}))

const userMock = vi.hoisted(() => ({ id: 'u1', email: 't@t.t', role: 'user' }))

vi.mock('@/stores/auth', () => ({
  useAuth: (sel?: (s: unknown) => unknown) => (sel ? sel({ user: userMock }) : { user: userMock }),
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
  cryptoDepositMock.mockReset()
  pollMock.mockReset()
  setActiveCurrencyMock.mockReset()
  closeDepositMock.mockReset()
  uiState.depositSheet = true
  uiState.depositCurrency = 'RUB'
  uiState.pendingGameSlug = null
  walletState.activeCurrency = 'RUB'
  walletState.active = null
})

afterEach(cleanup)

describe('Валидация суммы кассы (фидбек вместо молчаливого return)', () => {
  it('пустая сумма: подсказка у поля, API не вызывается', () => {
    kycMock.mockResolvedValue({ status: 'approved' })
    renderSheet()
    fireEvent.click(screen.getByRole('button', { name: /Перейти к оплате/ }))
    expect(screen.getByText('Выберите или введите сумму пополнения')).toBeTruthy()
    expect(depositMock).not.toHaveBeenCalled()
  })

  it('сумма ниже минимума: подсказка с минимумом из гео-конфига', () => {
    kycMock.mockResolvedValue({ status: 'approved' })
    renderSheet()
    fireEvent.change(screen.getByPlaceholderText('2000'), { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: /Перейти к оплате/ }))
    expect(screen.getByText('Минимальная сумма — 1 000 ₽')).toBeTruthy()
    expect(depositMock).not.toHaveBeenCalled()
  })

  it('ошибка сбрасывается при вводе суммы', () => {
    kycMock.mockResolvedValue({ status: 'approved' })
    renderSheet()
    fireEvent.click(screen.getByRole('button', { name: /Перейти к оплате/ }))
    expect(screen.getByText('Выберите или введите сумму пополнения')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('2000'), { target: { value: '2000' } })
    expect(screen.queryByText('Выберите или введите сумму пополнения')).toBeNull()
  })
})

describe('Пополнение не требует верификации (решение владельца 2026-10-07)', () => {
  // Раньше этот блок проверял обратное: касса читала `limit_remaining` из
  // GET /kyc, показывала «Без верификации можно выводить до …» и при нуле
  // уводила на /kyc вместо пополнения. Шлюз снят и на сервере, и здесь:
  // верификация нужна, чтобы ВЫВЕСТИ деньги, а не чтобы внести свои.
  it('CTA всегда «Перейти к оплате», на /kyc не отправляет', async () => {
    kycMock.mockResolvedValue({
      status: 'not_submitted',
      limit_remaining: '0',
      limit_currency: 'RUB',
      deposit_limit_rub: '5000',
    })
    renderSheet()
    const cta = await screen.findByRole('button', { name: 'Перейти к оплате' })
    cta.click()
    expect(pushMock).not.toHaveBeenCalledWith('/kyc')
  })

  it('не показывает остаток «лимита без верификации» в кассе', async () => {
    kycMock.mockResolvedValue({
      status: 'not_submitted',
      limit_remaining: '5000',
      limit_currency: 'RUB',
      deposit_limit_rub: '5000',
    })
    renderSheet()
    await screen.findByRole('button', { name: 'Перейти к оплате' })
    // Ни плашки про «лимит без верификации», ни кнопки «Лимит исчерпан». После
    // #208 пополнение вообще не ограничено верификацией, поэтому в кассе нечего
    // показывать. Отдельно держим правку из #207 (агент B): остаток
    // `limit_remaining` — величина депозитного лимита, и называть её «вывод до N»
    // нельзя: вывод требует approved KYC целиком (assertCanWithdraw). Теперь эта
    // ложь невозможна структурно — параграфа нет.
    expect(screen.queryByText(/Без верификации/)).toBeNull()
    expect(screen.queryByText(/Лимит исчерпан/)).toBeNull()
  })
})

/**
 * GAP-59: до этой правки `pay()` всегда слал `/payments/deposit/fiat`, поэтому с
 * активным USDT-кошельком касса обещала «Пополнить ₽» и вела в фиатную кассу —
 * крипто-пополнения во фронте не было вовсе (ТЗ ч.5.1 §4.9).
 */
describe('GAP-59: DepositSheet (крипта) — активный кошелёк, а не гео-фиат', () => {
  const usdtTicket = {
    payment_request_id: 'pr-1',
    pay_address: 'TQn5YYrLdRuV5BnZbPmSTNf7GkC1vXh3qW',
    pay_amount: '50.00',
    pay_currency: 'USDT_TRC20',
  }

  /**
   * Открывает кассу с USDT-кошелька, вводит сумму и жмёт «Перейти к оплате».
   * Дедлайн относительный: заявка живёт минуты, а не часы, и зафиксированная дата
   * («2026-09-30T12:00Z») краснила весь репо, как только этот час проходил.
   */
  async function requestCryptoDeposit(deadline = Date.now() + 40 * 60_000): Promise<void> {
    cryptoDepositMock.mockResolvedValue({
      ...usdtTicket,
      expires_at: new Date(deadline).toISOString(),
    })
    renderSheet()
    expect(await screen.findByRole('heading', { name: 'Пополнить USDT' })).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Перейти к оплате' }))
    await waitFor(() =>
      expect(cryptoDepositMock).toHaveBeenCalledWith({ amount: '50', currency: 'USDT_TRC20' }),
    )
  }

  beforeEach(() => {
    uiState.depositCurrency = undefined
    walletState.active = { currency: 'USDT_TRC20', available: '84.20' }
    kycMock.mockResolvedValue({ status: 'approved', limit_currency: 'USDT_TRC20' })
  })

  it('шифрует кошелёк, а не гео-фиат, и ведёт крипто-заявку в /deposit/crypto', async () => {
    await requestCryptoDeposit()
    // автоконвертации нет (Don't-лист §6): зачисление идёт в тот же USDT
    expect(depositMock).not.toHaveBeenCalled()
    expect(setActiveCurrencyMock).not.toHaveBeenCalled()
  })

  it('показывает сеть, сумму к отправке адрес и дедлайн — как отдал бэк', async () => {
    await requestCryptoDeposit()
    expect(await screen.findByText('TRC20')).toBeTruthy()
    expect(screen.getByText(/Отправьте только USDT в сети TRC20/)).toBeTruthy()
    expect(screen.getByText('50.00 USDT')).toBeTruthy()
    expect(screen.getByText(usdtTicket.pay_address)).toBeTruthy()
    expect(screen.getByRole('button', { name: /скопировать/i })).toBeTruthy()
    expect(screen.getByText(/Адрес действует ещё \d+ мин/)).toBeTruthy()
  })

  it('просроченный `expires_at` — плашка «Срок заявки истёк», а не обещание действующего адреса', async () => {
    await requestCryptoDeposit(Date.now() - 60_000)
    expect(await screen.findByText(/Срок заявки истёк/)).toBeTruthy()
    expect(screen.queryByText(/Адрес действует/)).toBeNull()
  })

  it('кладёт над адресом QR с тем же адресом заявки (ТЗ §4.9)', async () => {
    await requestCryptoDeposit()
    const qr = await screen.findByRole('img', { name: 'QR-код адреса кошелька' })
    expect(qr.tagName.toLowerCase()).toBe('svg')
    // react-qr-code рисует код двумя путями (модули + подложка): один путь = пустой код
    expect(qr.querySelectorAll('path')).toHaveLength(2)
  })

  it('«Проверить статус» при completed закрывает кассу', async () => {
    pollMock.mockResolvedValue({ id: 'pr-1', status: 'completed', currency: 'USDT_TRC20' })
    await requestCryptoDeposit()
    fireEvent.click(await screen.findByRole('button', { name: 'Проверить статус' }))
    await waitFor(() => expect(pollMock).toHaveBeenCalledWith('pr-1'))
    expect(closeDepositMock).toHaveBeenCalled()
  })

  it('не показывает фиатные пресеты под подписью USDT', async () => {
    renderSheet()
    await screen.findByRole('heading', { name: 'Пополнить USDT' })
    // /geo/config отдаёт depositPresets только для активного фиата
    // (geo-config.policy.ts:51), а автоконвертации нет — значит «1 000» в USDT
    // быть не может ни в каком виде.
    expect(screen.queryByText('1 000.00 USDT')).toBeNull()
    expect(screen.queryByText('10 000.00 USDT')).toBeNull()
    expect(screen.queryByText(/Минимум/)).toBeNull()
  })
})
