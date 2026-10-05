import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * §4.5/§4.3 + ТЗ ч.8: на телефоне десктоп-панели нет, а таб-бар фиксирован
 * четырьмя игровыми пунктами — поэтому вход в партнёрскую программу
 * (/affiliate, кабинет вебмастера) обязан быть в меню аватара.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/profile',
}))

const logoutMock = vi.hoisted(() => vi.fn())

vi.mock('@/stores/auth', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'p@p.p', role: 'user' }, logout: logoutMock }),
}))

// useMe тянет react-query (нужен провайдер) — тесту меню профиль не нужен.
vi.mock('@/hooks/useMe', () => ({
  useMe: () => ({ me: null, isLoading: false }),
}))

vi.mock('@/components/layout/UserAvatar', () => ({
  UserAvatar: () => <span data-testid="avatar" />,
}))

import { UserMenu } from '@/components/layout/UserMenu'

afterEach(cleanup)

describe('меню аватара: вход в партнёрскую программу', () => {
  it('содержит пункт «Партнёрская программа» со ссылкой на /affiliate', () => {
    render(<UserMenu email="p@p.p" />)
    fireEvent.click(screen.getByRole('button', { name: 'Меню пользователя' }))
    const link = screen.getByRole('link', { name: 'Партнёрская программа' })
    expect(link.getAttribute('href')).toBe('/affiliate')
  })

  it('кабинетные и сервисные пункты не теряются: кошелёк, история, партнёрка, поддержка, настройки', () => {
    render(<UserMenu email="p@p.p" />)
    fireEvent.click(screen.getByRole('button', { name: 'Меню пользователя' }))
    expect(screen.getByRole('link', { name: 'Мои кошельки' }).getAttribute('href')).toBe('/wallet')
    expect(screen.getByRole('link', { name: 'История игр' }).getAttribute('href')).toBe('/history')
    expect(screen.getByRole('link', { name: 'Партнёрская программа' }).getAttribute('href')).toBe(
      '/affiliate',
    )
    expect(screen.getByRole('link', { name: 'Поддержка' }).getAttribute('href')).toBe('/support')
    expect(screen.getByRole('link', { name: 'Настройки' }).getAttribute('href')).toBe(
      '/profile?tab=settings',
    )
  })
})
