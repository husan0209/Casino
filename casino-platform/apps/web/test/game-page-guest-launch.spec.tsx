import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Гость на `/casino/<slug>?launch=1` (ТЗ ч.5 §8.2 п.1): лист входа предлагается
 * один раз.
 *
 * Эффект авто-запуска зависел от объекта `useMutation` — он создаётся заново на
 * каждый рендер, поэтому каждый рендер звал `openLogin`, тот писал в стор, стор
 * ронял новый рендер, и React падал с «Maximum update depth exceeded». Тест
 * держит именно количество вызовов: один — норма, больше — цикл вернулся.
 */

const uiMock = vi.hoisted(() => ({
  openLogin: vi.fn(),
  openDeposit: vi.fn(),
  openWalletSwitcher: vi.fn(),
}))
const mutateMock = vi.hoisted(() => vi.fn())
const searchMock = vi.hoisted(() => ({ get: vi.fn(() => '1') }))

vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'neon-fruits' }),
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => searchMock,
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: { slug: 'neon-fruits', name: 'Neon Fruits', provider: null } }),
  useMutation: () => ({ mutate: mutateMock, isPending: false, isSuccess: false }),
}))

vi.mock('@/components/casino/GameCard', () => ({ GameCard: () => null }))
vi.mock('@/components/casino/GameThumb', () => ({ GameThumb: () => null }))
vi.mock('@/components/game/LaunchErrorScreen', () => ({ LaunchErrorScreen: () => null }))
vi.mock('@/hooks/useFavorites', () => ({
  useFavorites: () => ({ favoriteSlugs: new Set(), toggleFavorite: vi.fn() }),
}))
vi.mock('@/hooks/useDemoLaunch', () => ({
  useDemoLaunch: () => ({ startDemo: vi.fn(), isRunning: false }),
}))
vi.mock('@/lib/api', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  errCode: vi.fn(),
  errIsNetwork: vi.fn(),
  errStatus: vi.fn(),
}))
vi.mock('@/lib/api/casino.api', () => ({ fetchGamesPage: vi.fn() }))
vi.mock('@/stores/auth', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('@/stores/geo', () => ({ useGeoStore: () => ({ load: vi.fn() }) }))
vi.mock('@/stores/ui', () => ({ useUIStore: () => uiMock }))
vi.mock('@/stores/wallet', () => ({
  useWalletStore: () => ({
    activeCurrency: 'RUB',
    fetchWallets: vi.fn(),
    getActiveWallet: () => undefined,
    getLaunchBalance: () => null,
    setLastPlayed: vi.fn(),
  }),
}))

import GamePage from '@/app/casino/[slug]/page'

beforeEach(() => {
  uiMock.openLogin.mockReset()
  uiMock.openDeposit.mockReset()
  mutateMock.mockReset()
})

afterEach(cleanup)

describe('страница игры: гость по ?launch=1', () => {
  it('лист входа открывается ровно один раз, запуск не дёргается', () => {
    // rerender, а не три render(): нужен один и тот же экземпляр — именно на
    // повторных рендерах старого эффекта `launch` менял ссылку и зацикливал лист.
    const { rerender } = render(<GamePage />)
    rerender(<GamePage />)
    rerender(<GamePage />)

    expect(uiMock.openLogin).toHaveBeenCalledTimes(1)
    expect(uiMock.openLogin).toHaveBeenCalledWith('neon-fruits')
    expect(mutateMock).not.toHaveBeenCalled()
  })
})
