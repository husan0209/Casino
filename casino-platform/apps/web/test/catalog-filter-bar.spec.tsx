import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * §7: тулбар фильтров каталога после редизайна — провайдеры чипами с
 * аватарками (нативные select с десятками неотличимых опций не читаются),
 * сортировка кастомным дропдауном, поиск с debounce и очисткой, активные
 * фильтры — съёмные чипы. URL-состояние не менялось (lib/catalog-filters).
 */

const onChangeMock = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryFn: () => unknown }) => ({ data: options.queryFn() }),
}))

vi.mock('@/lib/api/casino.api', () => ({
  fetchCategories: () => [
    { slug: 'slots', name: 'Слоты', game_count: 10 },
    { slug: 'empty', name: 'Пустая', game_count: 0 },
  ],
  fetchProviders: () => [
    { slug: 'rg-1', name: 'RG provider', logo_url: null, game_count: 20 },
    { slug: 'it-1', name: 'IT provider', logo_url: null, game_count: 11 },
  ],
}))

import { CatalogFilterBar } from '@/components/casino/CatalogFilterBar'
import { EMPTY_FILTERS } from '@/lib/ui/catalog-filters'

beforeEach(() => {
  onChangeMock.mockReset()
})

afterEach(cleanup)

function renderBar(
  filters: Parameters<typeof CatalogFilterBar>[0]['filters'] = EMPTY_FILTERS,
  total = 31,
): void {
  render(
    <CatalogFilterBar filters={filters} total={total} loading={false} onChange={onChangeMock} />,
  )
}

describe('Каталог: тулбар фильтров', () => {
  it('пустая категория не показывается, провайдер выбирается чипом', () => {
    renderBar()
    expect(screen.queryByText('Пустая')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'RG provider' }))
    expect(onChangeMock).toHaveBeenCalledWith({ provider: 'rg-1' })
  })

  it('сортировка — кастомный дропдаун: открыть, выбрать, меню закрылось', () => {
    renderBar()
    fireEvent.click(screen.getByRole('button', { name: /По умолчанию/ }))
    fireEvent.click(screen.getByRole('option', { name: 'Новые' }))
    expect(onChangeMock).toHaveBeenCalledWith({ sort: 'new' })
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('активные фильтры — съёмные чипы плюс сброс одной кнопкой', () => {
    renderBar({ ...EMPTY_FILTERS, provider: 'rg-1', q: 'sweet' }, 5)
    fireEvent.click(screen.getByRole('button', { name: 'Убрать фильтр «sweet»' }))
    expect(onChangeMock).toHaveBeenCalledWith({ q: '' })
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить всё' }))
    expect(onChangeMock).toHaveBeenCalledWith({ category: '', provider: '', sort: '', q: '' })
  })

  it('поиск: debounce 300 мс; очистка не даёт дубля onChange', () => {
    vi.useFakeTimers()
    try {
      renderBar()
      const input = screen.getByLabelText('Поиск по каталогу')
      fireEvent.change(input, { target: { value: 'sweet' } })
      expect(screen.getByRole('button', { name: 'Очистить поиск' })).toBeTruthy()
      expect(onChangeMock).not.toHaveBeenCalled()
      vi.advanceTimersByTime(300)
      expect(onChangeMock).toHaveBeenCalledWith({ q: 'sweet' })
      // Очистка возвращает draft к значению фильтра — повторного onChange нет
      fireEvent.click(screen.getByRole('button', { name: 'Очистить поиск' }))
      vi.advanceTimersByTime(300)
      expect(onChangeMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('лента провайдеров: мышь тянет скролл, клик после драга глушится', () => {
    renderBar()
    const row = screen.getByRole('group', { name: 'Провайдеры' })
    Object.defineProperty(row, 'scrollLeft', { value: 0, writable: true })
    // jsdom теряет clientX у PointerEvent — диспетчеризуем MouseEvent с координатами
    const dragEvent = (type: string, clientX: number): void => {
      row.dispatchEvent(new MouseEvent(type, { clientX, bubbles: true, cancelable: true }))
    }

    dragEvent('pointerdown', 200)
    dragEvent('pointermove', 140)
    expect(row.scrollLeft).toBe(60)

    dragEvent('pointerup', 140)
    // moved=true ещё живёт до клика — чип под курсором не должен выбраться
    fireEvent.click(screen.getByRole('button', { name: 'RG provider' }))
    expect(onChangeMock).not.toHaveBeenCalled()
  })

  it('лента провайдеров: обычный клик без драга выбирает чип', () => {
    renderBar()
    fireEvent.click(screen.getByRole('button', { name: 'RG provider' }))
    expect(onChangeMock).toHaveBeenCalledWith({ provider: 'rg-1' })
  })
})
