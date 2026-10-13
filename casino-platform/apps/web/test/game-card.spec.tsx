import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Тап по карточке игры на витрине (ТЗ ч.5 §4.5, §6.4): открывается карточка
 * игры, а не запуск. До этого витрина пушила `/casino/<slug>?launch=1`, страница
 * сама дёргала launch и на `INSUFFICIENT_FUNDS` показывала кассу — игрок без
 * денег попадал в пополнение, так и не увидев игру.
 *
 * Компактный вьюпорт (до `md`) — шторка поверх витрины, шире — страница игры.
 * Гость получает карточку на равных: вход он сделает по кнопке «Играть на
 * деньги» внутри неё.
 */

const ui = vi.hoisted(() => ({
  openGamePreview: vi.fn(),
  openLogin: vi.fn(),
  openDeposit: vi.fn(),
}))
const navigation = vi.hoisted(() => ({ push: vi.fn(), prefetch: vi.fn() }))
const auth = vi.hoisted(() => ({ user: null as { id: string } | null }))

vi.mock('@/stores/ui', () => ({ useUIStore: () => ui }))
vi.mock('next/navigation', () => ({ useRouter: () => navigation }))
vi.mock('@/stores/auth', () => ({ useAuth: () => ({ user: auth.user }) }))

import { GameCard } from '@/components/casino/GameCard'
import type { GameDto } from '@/types/casino'

const GAME: GameDto = {
  id: 'g-1',
  slug: 'sweet-bonanza',
  name: 'Sweet Bonanza',
  hasDemo: true,
  volatility: 'HIGH',
  provider: { id: 'p-1', slug: 'pragmatic', name: 'Pragmatic Play' },
}

/** jsdom не размечает медиазапросы: ширину экрана подставляем руками. */
function setCompactViewport(compact: boolean): void {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (): MediaQueryList =>
      ({
        matches: compact,
        media: '(max-width: 767px)',
        addEventListener: (): void => undefined,
        removeEventListener: (): void => undefined,
      }) as unknown as MediaQueryList,
  )
}

function tapCover(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Играть в Sweet Bonanza' }))
}

beforeEach(() => {
  ui.openGamePreview.mockReset()
  ui.openLogin.mockReset()
  ui.openDeposit.mockReset()
  navigation.push.mockReset()
  navigation.prefetch.mockReset()
  auth.user = null
})

afterEach((): void => {
  cleanup()
  vi.restoreAllMocks()
})

describe('GameCard: тап по обложке', () => {
  it('телефон гостю: шторка карточки, ни входа, ни кассы, ни перехода', () => {
    setCompactViewport(true)
    render(<GameCard game={GAME} />)

    tapCover()

    expect(ui.openGamePreview).toHaveBeenCalledWith({
      game: GAME,
      isFavorite: false,
      onToggleFavorite: undefined,
    })
    expect(ui.openLogin).not.toHaveBeenCalled()
    expect(ui.openDeposit).not.toHaveBeenCalled()
    expect(navigation.push).not.toHaveBeenCalled()
  })

  it('телефон игроку: та же шторка — выбор режима остаётся в ней', () => {
    setCompactViewport(true)
    auth.user = { id: 'u1' }
    render(<GameCard game={GAME} />)

    tapCover()

    expect(ui.openGamePreview).toHaveBeenCalledTimes(1)
    expect(navigation.push).not.toHaveBeenCalled()
  })

  it('десктоп: страница игры, и без launch-флага', () => {
    setCompactViewport(false)
    auth.user = { id: 'u1' }
    render(<GameCard game={GAME} />)

    tapCover()

    expect(navigation.push).toHaveBeenCalledWith('/casino/sweet-bonanza')
    expect(ui.openGamePreview).not.toHaveBeenCalled()
  })

  it('Enter по карточке работает так же, как тап', () => {
    setCompactViewport(true)
    render(<GameCard game={GAME} />)

    fireEvent.keyDown(screen.getByRole('button', { name: 'Играть в Sweet Bonanza' }), {
      key: 'Enter',
    })

    expect(ui.openGamePreview).toHaveBeenCalledTimes(1)
  })

  it('избранное передаётся в шторку тем же состоянием, что и у карточки', () => {
    setCompactViewport(true)
    const onToggleFavorite = vi.fn((): void => undefined)
    render(<GameCard game={GAME} isFavorite onToggleFavorite={onToggleFavorite} />)

    tapCover()

    expect(ui.openGamePreview).toHaveBeenCalledWith({
      game: GAME,
      isFavorite: true,
      onToggleFavorite,
    })
  })
})
