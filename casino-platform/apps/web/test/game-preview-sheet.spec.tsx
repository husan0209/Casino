import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ТЗ ч.5 §4.5/§4.7/§8.2: карточка игры шторкой. Тест держит то, чего не видят
 * типы: характеристики берутся из полей API (раньше страница игры показывала
 * «Высокая» и «Оригинал» всем слотам подряд), гостю предлагается вход, а не
 * кнопка «Играть на деньги», и «Играть на деньги» при пустом кошельке ведёт в
 * кассу, а не в попытку запуска.
 */

const game = {
  id: 'g1',
  slug: 'neon-fruits',
  name: 'Neon Fruits',
  rtp: '96.50',
  volatility: 'medium',
  hasDemo: true,
  provider: { id: 'p1', slug: 'playson', name: 'Playson' },
}

const detailsMock = vi.hoisted(() => vi.fn())
const closeMock = vi.hoisted(() => vi.fn())
const openLoginMock = vi.hoisted(() => vi.fn())
const openDepositMock = vi.hoisted(() => vi.fn())
const pushMock = vi.hoisted(() => vi.fn())
const authMock = vi.hoisted(() => ({ user: null as { email: string } | null }))
const walletMock = vi.hoisted(() => ({ available: '1240.00', active: true }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}))

vi.mock('@/lib/api/casino.api', () => ({
  fetchGameDetails: detailsMock,
  launchDemo: vi.fn(),
}))

vi.mock('@/stores/ui', () => ({
  useUIStore: () => ({
    gamePreview: { game, isFavorite: false, onToggleFavorite: undefined },
    closeGamePreview: closeMock,
    openLogin: openLoginMock,
    openDeposit: openDepositMock,
  }),
}))

vi.mock('@/stores/auth', () => ({
  useAuth: () => ({ user: authMock.user }),
}))

vi.mock('@/stores/wallet', () => ({
  useWalletStore: () => ({
    activeCurrency: 'RUB',
    getActiveWallet: (): { currency: string; available: string } | undefined =>
      walletMock.active ? { currency: 'RUB', available: walletMock.available } : undefined,
    // Как `stores/wallet.getLaunchBalance`: нет активного кошелька, но балансы
    // уже приходили — это «0», а не «неизвестно».
    getLaunchBalance: (): string => (walletMock.active ? walletMock.available : '0'),
  }),
}))

import { GamePreviewSheet } from '@/components/casino/GamePreviewSheet'

function renderSheet(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <GamePreviewSheet />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  detailsMock.mockResolvedValue({ ...game, minBet: '10.00000000', bannerUrl: null })
  walletMock.available = '1240.00'
  walletMock.active = true
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  authMock.user = null
  walletMock.available = '1240.00'
  walletMock.active = true
})

describe('шторка превью игры (§4.5)', () => {
  it('провайдер, название и характеристики — из полей API', async () => {
    renderSheet()
    expect(await screen.findByText('Neon Fruits')).toBeTruthy()
    expect(screen.getByText('Playson')).toBeTruthy()
    await waitFor(() => expect(detailsMock).toHaveBeenCalledWith('neon-fruits'))

    // Возврат игроку не показываем: это внутренний параметр админки, и он
    // не обязан совпадать с тем, что игрок увидит на конкретной доске.
    expect(screen.queryByText('RTP')).toBeNull()
    expect(screen.queryByText('96.5%')).toBeNull()
    expect(screen.getByText('Волатильность')).toBeTruthy()
    expect(screen.getByText('Средняя')).toBeTruthy()
    expect(screen.getByText('Мин. ставка')).toBeTruthy()
    expect(screen.getByText('10 ₽')).toBeTruthy()
  })

  it('гостю — вход с продолжением launch, и без строки баланса (§8.2)', async () => {
    renderSheet()
    const cta = await screen.findByRole('button', { name: 'Войти, чтобы играть' })
    fireEvent.click(cta)

    expect(closeMock).toHaveBeenCalled()
    expect(openLoginMock).toHaveBeenCalledWith('neon-fruits')
    expect(screen.queryByText(/Активный баланс/)).toBeNull()
  })

  it('своему — «Играть на деньги» и активный баланс', async () => {
    authMock.user = { email: 'player@example.com' }
    renderSheet()

    expect(await screen.findByRole('button', { name: /Играть на деньги/ })).toBeTruthy()
    expect(screen.getByText(/Активный баланс/)).toBeTruthy()
    expect(screen.getByText('1 240 ₽')).toBeTruthy()
    expect(screen.queryByText('Войти, чтобы играть')).toBeNull()
  })

  it('своему без денег: касса с адресом игры, без попытки запуска', async () => {
    authMock.user = { email: 'player@example.com' }
    walletMock.available = '0.00'
    renderSheet()

    fireEvent.click(await screen.findByRole('button', { name: /Играть на деньги/ }))

    expect(closeMock).toHaveBeenCalled()
    expect(openDepositMock).toHaveBeenCalledWith('RUB', 'neon-fruits')
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('новый игрок без кошельков: то же — касса, а не лишний переход на страницу', async () => {
    authMock.user = { email: 'fresh@example.com' }
    walletMock.active = false
    renderSheet()

    fireEvent.click(await screen.findByRole('button', { name: /Играть на деньги/ }))

    expect(openDepositMock).toHaveBeenCalledWith('RUB', 'neon-fruits')
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('своему с деньгами: запуск через страницу игры', async () => {
    authMock.user = { email: 'player@example.com' }
    renderSheet()

    fireEvent.click(await screen.findByRole('button', { name: /Играть на деньги/ }))

    expect(closeMock).toHaveBeenCalled()
    expect(openDepositMock).not.toHaveBeenCalled()
    expect(pushMock).toHaveBeenCalledWith('/casino/neon-fruits?launch=1')
  })
})
