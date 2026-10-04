import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * §6.1 п.0: у залогиненного на главной — партнёрский баннер (ТЗ ч.8) вместо
 * гостевого героя: один оффер, один CTA на /affiliate, без выдуманных цифр.
 * Гостю баннер не показывается — у гостя свой GuestHero.
 */

const authState = vi.hoisted(() => ({
  user: null as { id: string; email: string; role: string } | null,
}))

vi.mock('@/stores/auth', () => ({
  useAuth: () => ({ user: authState.user }),
}))

import { PartnerHero } from '@/components/casino/PartnerHero'

afterEach(cleanup)

describe('PartnerHero: партнёрский баннер главной для своего игрока', () => {
  it('залогиненному: оффер «Станьте нашим партнёром» и CTA на /affiliate', () => {
    authState.user = { id: 'u1', email: 'p@p.p', role: 'user' }
    render(<PartnerHero />)
    expect(screen.getByText('Станьте нашим')).toBeTruthy()
    const cta = screen.getByRole('link', { name: 'Стать партнёром' })
    expect(cta.getAttribute('href')).toBe('/affiliate')
    expect(screen.getByText('RevShare от NGR')).toBeTruthy()
  })

  it('гостю баннер не рендерится — у гостя свой GuestHero', () => {
    authState.user = null
    const { container } = render(<PartnerHero />)
    expect(container.textContent).toBe('')
  })
})
