import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ТЗ ч.5.1 §4.5/§4.7: «i» на карточке открывает шторку превью. Тест держит то,
 * чего не видят типы: характеристики берутся из полей API (раньше страница игры
 * показывала «Высокая» и «Оригинал» всем слотам подряд), а гостю предлагается
 * вход, а не кнопка «Играть на деньги».
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
const authMock = vi.hoisted(() => ({ user: null as { email: string } | null }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
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
  }),
}))

vi.mock('@/stores/auth', () => ({
  useAuth: () => ({ user: authMock.user }),
}))

vi.mock('@/stores/wallet', () => ({
  useWalletStore: () => ({
    activeCurrency: 'RUB',
    getActiveWallet: () => ({ currency: 'RUB', available: '1240.00' }),
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
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  authMock.user = null
})

describe('шторка превью игры (§4.5)', () => {
  it('провайдер, название и характеристики — из полей API', async () => {
    renderSheet()
    expect(await screen.findByText('Neon Fruits')).toBeTruthy()
    expect(screen.getByText('Playson')).toBeTruthy()
    await waitFor(() => expect(detailsMock).toHaveBeenCalledWith('neon-fruits'))

    expect(screen.getByText('RTP')).toBeTruthy()
    expect(screen.getByText('96.5%')).toBeTruthy()
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
})
