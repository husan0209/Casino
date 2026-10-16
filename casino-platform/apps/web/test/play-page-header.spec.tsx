import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import GamePlayPage from '../src/app/casino/[slug]/play/page'

/**
 * На планке `/play` не должно быть чисел (решение владельца 2026-10-16).
 *
 * Свою сумму игра рисует сама и получает её с того же сервера
 * (`originals-session.use-case.ts`: `credit = balance.available`), а вторая
 * цифра рядом — это либо противоречие в демо («0 ₽» рядом со 1 000 ₽
 * виртуальных), либо отставание в деньги: без WebSocket (§2.1) шапка узнала бы
 * о ставке только по возврату фокуса. Проверка держит оба правила: выхода и
 * пополнения есть, любого числа — нет.
 */

const walletState = vi.hoisted(() => ({
  activeCurrency: 'RUB',
  refreshActive: vi.fn(),
  getActiveWallet: () => ({ currency: 'RUB', available: '1234.56' }),
}))

const openDepositMock = vi.hoisted(() => vi.fn())
type FakeUser = { id: string; email: string; role: string }

const userState = vi.hoisted(() => ({
  user: { id: 'u1', email: 'p@p.p', role: 'user' } as FakeUser | null,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({
    get: (key: string) => (key === 'url' ? 'https://x/house/fortunetiger/index.html' : null),
  }),
}))

vi.mock('@/components/game/GameFrame', () => ({ GameFrame: () => null }))
vi.mock('@/stores/wallet', () => ({ useWalletStore: () => walletState }))
vi.mock('@/stores/ui', () => ({ useUIStore: () => ({ openDeposit: openDepositMock }) }))
vi.mock('@/stores/auth', () => ({ useAuth: () => userState }))

afterEach(() => {
  cleanup()
  userState.user = { id: 'u1', email: 'p@p.p', role: 'user' }
})

describe('планка /play', () => {
  it('есть выход и пополнение, и ни одного числа', () => {
    const { container } = render(<GamePlayPage />)

    expect(screen.getByRole('button', { name: 'Выйти из игры' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Пополнить баланс' })).toBeTruthy()
    expect(container.textContent).not.toMatch(/\d/)
  })

  it('гость видит выход, но не кнопку пополнения', () => {
    userState.user = null
    const { container } = render(<GamePlayPage />)

    expect(screen.getByRole('button', { name: 'Выйти из игры' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Пополнить баланс' })).toBeNull()
    expect(container.textContent).not.toMatch(/\d/)
  })
})
