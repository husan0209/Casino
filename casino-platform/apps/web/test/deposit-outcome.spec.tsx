import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Кошелёк обязан различать итог оплаты, которым платёжная система возвращает
 * игрока (`?deposit=success` / `?deposit=failed`): без этого экран после возврата
 * из кассы выглядит так, будто ничего не происходило. Отдельная ловушка, которую
 * сторожит последняя проверка: параметр после показа вычищается из адреса, и если
 * баннер читает его напрямую, он исчезает в том же кадре.
 */

const params = vi.hoisted(() => ({ current: new URLSearchParams() }))
const replaceMock = vi.hoisted(() => vi.fn())
const invalidateMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useSearchParams: () => params.current,
  useRouter: () => ({ replace: replaceMock }),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: invalidateMock }),
}))

import { DepositOutcome } from '@/components/wallet/DepositOutcome'

beforeEach(() => {
  replaceMock.mockReset()
  invalidateMock.mockReset()
})

afterEach(() => {
  cleanup()
  params.current = new URLSearchParams()
})

describe('итог оплаты на экране кошелька', () => {
  it('без параметра ничего не показывает', () => {
    const { container } = render(<DepositOutcome onRetry={() => {}} />)

    expect(container.innerHTML).toBe('')
    expect(invalidateMock).not.toHaveBeenCalled()
  })

  it('успех: статус-баннер, тревога балансов и чистка адреса', () => {
    params.current = new URLSearchParams('deposit=success')
    render(<DepositOutcome onRetry={() => {}} />)

    expect(screen.getByRole('status').textContent).toContain('Оплата прошла')
    expect(invalidateMock).toHaveBeenCalledWith({ queryKey: ['wallet'] })
    expect(replaceMock).toHaveBeenCalledWith('/wallet', { scroll: false })
  })

  it('неуспех: alert с кнопкой повтора, открывающей кассу', () => {
    params.current = new URLSearchParams('deposit=failed')
    const onRetry = vi.fn()
    render(<DepositOutcome onRetry={onRetry} />)

    expect(screen.getByRole('alert').textContent).toContain('Платёж не завершён')
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('неизвестное значение параметра не показывает ничего', () => {
    params.current = new URLSearchParams('deposit=maybe')
    const { container } = render(<DepositOutcome onRetry={() => {}} />)

    expect(container.innerHTML).toBe('')
  })

  it('баннер переживает чистку URL: игрок успевает его прочитать', () => {
    params.current = new URLSearchParams('deposit=success')
    const view = render(<DepositOutcome onRetry={() => {}} />)
    expect(view.container.textContent).toContain('Оплата прошла')

    // router.replace отработал: параметра в адресе больше нет.
    params.current = new URLSearchParams()
    view.rerender(<DepositOutcome onRetry={() => {}} />)

    expect(screen.getByRole('status').textContent).toContain('Оплата прошла')
  })
})
