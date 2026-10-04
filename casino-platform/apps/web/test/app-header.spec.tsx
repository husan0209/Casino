import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * GAP-59 (жалоба игрока): шапка подписывала баланс фиатом из `/geo/config`, а число
 * брала из активного кошелька. Итог: 82.20 USDT показывались как «82.20 ₽», а
 * 3 200 ₴ — как «3 200 ₽» до перезагрузки гео-конфига. Автоконвертации по ТЗ нет
 * (ч.5.1 Don't-лист §6), поэтому держим обратное: метка = валюта кошелька.
 */

const walletState = vi.hoisted(() => ({
  activeCurrency: 'RUB',
  active: null as { currency: string; available: string } | null,
}))

const openDepositMock = vi.hoisted(() => vi.fn())
const openLoginMock = vi.hoisted(() => vi.fn())

const authState = vi.hoisted(() => ({
  user: {
    id: 'u1',
    email: 'p@p.p',
    role: 'user',
  } as {
    id: string
    email: string
    role: string
  } | null,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
}))

vi.mock('@/components/layout/UserMenu', () => ({
  UserMenu: () => null,
}))

vi.mock('@/stores/auth', () => ({
  useAuth: () => ({ user: authState.user, logout: vi.fn() }),
  useAuthStore: { getState: () => ({ user: authState.user }) },
}))

vi.mock('@/stores/geo', () => ({
  useGeoStore: () => ({ config: { activeCurrency: 'RUB' }, load: vi.fn() }),
}))

vi.mock('@/stores/ui', () => ({
  useUIStore: () => ({
    openDeposit: openDepositMock,
    openLogin: openLoginMock,
    openWalletSwitcher: vi.fn(),
  }),
}))

vi.mock('@/stores/wallet', () => ({
  useWalletStore: () => ({
    activeCurrency: walletState.activeCurrency,
    fetchWallets: vi.fn(),
    getActiveWallet: () => walletState.active ?? undefined,
  }),
}))

import { AppHeader } from '@/components/layout/AppHeader'

function balanceChip(): HTMLElement {
  return screen.getByRole('button', { name: 'Сменить активный кошелёк' })
}

beforeEach(() => {
  openDepositMock.mockReset()
  openLoginMock.mockReset()
  authState.user = { id: 'u1', email: 'p@p.p', role: 'user' }
  walletState.activeCurrency = 'RUB'
  walletState.active = null
})

afterEach(cleanup)

describe('GAP-59: метка баланса в шапке = валюта активного кошелька', () => {
  it('USDT-кошелёк: «84.20 USDT», а не рубли', () => {
    walletState.active = { currency: 'USDT_TRC20', available: '84.20' }
    render(<AppHeader />)
    expect(balanceChip().textContent).toContain('84.20 USDT')
    expect(balanceChip().textContent).not.toContain('₽')
  })

  it('гривна: «3 200 ₴», а не «3 200 ₽»', () => {
    walletState.active = { currency: 'UAH', available: '3200' }
    render(<AppHeader />)
    expect(balanceChip().textContent).toContain('3 200 ₴')
  })

  it('плюс уводит в кассу валюты кошелька', () => {
    walletState.active = { currency: 'USDT_TRC20', available: '84.20' }
    render(<AppHeader />)
    fireEvent.click(screen.getByRole('button', { name: 'Пополнить' }))
    expect(openDepositMock).toHaveBeenCalledWith('USDT_TRC20')
  })

  it('без кошельков — страховка из activeCurrency, 0 ₽', () => {
    render(<AppHeader />)
    expect(balanceChip().textContent).toContain('0 ₽')
  })
})

describe('§5: у гостя шапка открывает лист, а не отдельные страницы', () => {
  it('«Регистрация» → openLogin(undefined, "register")', () => {
    authState.user = null
    render(<AppHeader />)
    fireEvent.click(screen.getByRole('button', { name: 'Регистрация' }))
    expect(openLoginMock).toHaveBeenCalledWith(undefined, 'register')
  })

  it('«Войти» → openLogin(undefined, "login")', () => {
    authState.user = null
    render(<AppHeader />)
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }))
    expect(openLoginMock).toHaveBeenCalledWith(undefined, 'login')
  })
})
