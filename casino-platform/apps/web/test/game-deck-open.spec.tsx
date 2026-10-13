import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Тап по карте тиндер-колоды главной (ТЗ ч.5 §4.5, ч.5.1 §4.4): открывается
 * карточка игры поверх колоды, а не запуск. Раньше тап по карте вёл сразу
 * `/casino/<slug>?launch=1`, страница дёргала launch, и игрок без денег получал
 * кассу, так и не увидев игру.
 */

const navigation = vi.hoisted(() => ({ push: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }))
const ui = vi.hoisted(() => ({ openLogin: vi.fn(), openDeposit: vi.fn() }))

vi.mock('next/navigation', () => ({ useRouter: () => navigation }))
vi.mock('@/stores/ui', () => ({ useUIStore: () => ui }))

import { GameDeck } from '@/components/casino/GameDeck'
import { useAuth } from '@/stores/auth'
import { useWalletStore } from '@/stores/wallet'
import type { GameDto } from '@/types/casino'

const GAME: GameDto = {
  id: 'g-1',
  slug: 'sweet-bonanza',
  name: 'Sweet Bonanza',
  hasDemo: true,
  volatility: 'high',
  provider: { id: 'p-1', slug: 'pragmatic', name: 'Pragmatic Play' },
}

const DIALOG_NAME = 'Превью игры «Sweet Bonanza»'

function playButton(): HTMLElement {
  const button = screen.queryByRole('button', { name: /^Играть/ })
  if (button === null) {
    throw new Error('кнопка «Играть» на карте не найдена')
  }
  return button
}

/** Карточка открыта — возвращаем её контейнер: внутри свои «Играть» и «Демо». */
function openCard(): HTMLElement {
  const dialog = screen.queryByRole('dialog', { name: DIALOG_NAME })
  if (dialog === null) {
    throw new Error(`карточка игры «${DIALOG_NAME}» не открыта`)
  }
  return dialog
}

/**
 * Колода на монтировании читает `prefers-reduced-motion`, а jsdom этого API не
 * даёт. Значение всегда «движение разрешено»: жестов в этом спеке нет.
 */
function stubMatchMedia(): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (): MediaQueryList =>
      ({
        matches: false,
        media: '',
        addEventListener: (): void => undefined,
        removeEventListener: (): void => undefined,
      }) as unknown as MediaQueryList,
  })
}

beforeEach(() => {
  stubMatchMedia()
  navigation.push.mockReset()
  ui.openLogin.mockReset()
  ui.openDeposit.mockReset()
})

afterEach((): void => {
  cleanup()
  Reflect.deleteProperty(window, 'matchMedia')
  useAuth.setState({ user: null })
  useWalletStore.setState({ wallets: [], activeCurrency: 'RUB' })
})

describe('GameDeck: тап по карте', () => {
  it('гостю — карточка игры, а не вход и не переход', () => {
    render(<GameDeck games={[GAME]} />)

    fireEvent.click(playButton())

    expect(screen.getByRole('dialog', { name: DIALOG_NAME })).toBeTruthy()
    expect(ui.openLogin).not.toHaveBeenCalled()
    expect(navigation.push).not.toHaveBeenCalled()
  })

  it('«Играть» внутри карточки гостя ведёт во вход с адресом игры', () => {
    render(<GameDeck games={[GAME]} />)
    fireEvent.click(playButton())

    fireEvent.click(within(openCard()).getByRole('button', { name: /^Играть/ }))

    expect(ui.openLogin).toHaveBeenCalledWith('sweet-bonanza')
    expect(navigation.push).not.toHaveBeenCalled()
  })

  it('карточка закрывается по своей кнопке', () => {
    render(<GameDeck games={[GAME]} />)
    fireEvent.click(playButton())

    fireEvent.click(within(openCard()).getByRole('button', { name: 'Закрыть превью' }))

    expect(screen.queryByRole('dialog', { name: DIALOG_NAME })).toBeNull()
  })

  it('своему без денег: «Играть» в карточке ведёт в кассу с адресом игры', () => {
    useAuth.setState({ user: { id: 'u1', email: 'p@mail.test' } as never })
    useWalletStore.setState({
      wallets: [{ currency: 'RUB', balance: '0', locked: '0', available: '0' }],
      activeCurrency: 'RUB',
    } as never)

    render(<GameDeck games={[GAME]} />)
    fireEvent.click(playButton())
    fireEvent.click(within(openCard()).getByRole('button', { name: /^Играть/ }))

    expect(ui.openDeposit).toHaveBeenCalledWith('RUB', 'sweet-bonanza')
    expect(navigation.push).not.toHaveBeenCalled()
  })
})
