import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * GAP-49, правило нейтральности (docs/LEGAL_COMPLIANCE.md §2): на обвязке
 * правовых документов не должно быть ни бренда, ни самоназвания — игрок узнаёт,
 * с кем он заключает договор, из текста самого документа, а не из шапки.
 * Спека — машина за тем, что иначе проверяется глазами на скриншоте.
 */
import { LegalChrome } from '@/components/layout/LegalChrome'

afterEach(() => {
  cleanup()
})

describe('GAP-49: нейтральная обвязка /legal/*', () => {
  it('в обвязке нет бренда и слова «казино»', () => {
    const { container } = render(
      <LegalChrome>
        <p>Текст документа</p>
      </LegalChrome>,
    )

    expect(container.textContent).not.toMatch(/casino|spinera|казино/i)
  })

  it('содержимое документа рендерится, навигация казино — нет', () => {
    render(
      <LegalChrome>
        <p>Текст документа</p>
      </LegalChrome>,
    )

    expect(screen.getByText('Текст документа')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /пополнить|ввести|войти|регистрация/i })).toBeNull()
  })

  it('возврат на главную, четыре документа, поддержка и 18+ — на месте', () => {
    render(
      <LegalChrome>
        <p>Текст документа</p>
      </LegalChrome>,
    )

    const href = (name: string): string | null =>
      screen.getByRole('link', { name }).getAttribute('href')

    expect(href('← На главную')).toBe('/')
    expect(href('Условия использования')).toBe('/legal/terms')
    expect(href('Политика конфиденциальности')).toBe('/legal/privacy')
    expect(href('Политика cookie')).toBe('/legal/cookies')
    expect(href('Ответственная игра')).toBe('/legal/responsible-gaming')
    expect(href('Поддержка')).toBe('/support')
    expect(screen.getByText('18+')).toBeTruthy()
  })
})
