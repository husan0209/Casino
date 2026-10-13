import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Logo } from '@/components/layout/Logo'

/**
 * Градиент фиолетового квадрата обязан принадлежать своему экземпляру логотипа.
 *
 * В шапке две копии `Logo` (до 400px и от 400px), и одна из них лежит в
 * `display:none`. Общий id на обе означал, что видимый логотип ссылается на
 * первый по документу градиент — а из скрытого поддерева Chrome краску не берёт,
 * и значок оставался без цвета.
 */

function gradientIds(container: HTMLElement): string[] {
  return [...container.querySelectorAll('linearGradient')].map((node) => node.id)
}

function fillOfFirstRect(container: HTMLElement): string {
  const rect = container.querySelector('rect')
  if (rect === null) {
    throw new Error('квадрата логотипа нет')
  }
  return rect.getAttribute('fill') ?? ''
}

afterEach(cleanup)

describe('Logo: градиент на экземпляр', () => {
  it('две копии дают разные id и каждая ссылается на свой градиент', () => {
    const { container } = render(
      <>
        <div style={{ display: 'none' }}>
          <Logo size={28} withWordmark={false} />
        </div>
        <Logo size={30} />
      </>,
    )

    const ids = gradientIds(container)
    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
    expect(fillOfFirstRect(container)).toBe(`url(#${ids[0] ?? ''})`)
  })

  it('id без двоеточий: в url(#…) их разные движки читают по-разному', () => {
    const { container } = render(<Logo />)

    const id = gradientIds(container)[0] ?? ''
    expect(id).not.toContain(':')
    expect(id.startsWith('logo-grad-')).toBe(true)
  })
})
