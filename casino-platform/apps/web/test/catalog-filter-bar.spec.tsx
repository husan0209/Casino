import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * §7: тулбар фильтров каталога — провайдерского фильтра в UI НЕТ (игроки не
 * думают провайдерами; ищут игру по названию), сортировка — кастомный
 * дропдаун, поиск с debounce и очисткой, активные фильтры — съёмные чипы.
 * ?provider= из старых ссылок honoured: показывается съёмный чип.
 * URL-состояние не менялось (lib/catalog-filters).
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
  it('пустая категория не показывается, категория выбирается чипом', () => {
    renderBar()
    expect(screen.queryByText('Пустая')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Слоты' }))
    expect(onChangeMock).toHaveBeenCalledWith({ category: 'slots' })
  })

  it('провайдерского фильтра в тулбаре нет; лист «Фильтры» — дубль, тоже убран', () => {
    renderBar()
    expect(screen.queryByRole('group', { name: 'Провайдеры' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'RG provider' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Фильтры' })).toBeNull()
  })

  it('сортировка — кастомный дропдаун: открыть, выбрать, меню закрылось', () => {
    renderBar()
    fireEvent.click(screen.getByRole('button', { name: /По умолчанию/ }))
    fireEvent.click(screen.getByRole('option', { name: 'Новые' }))
    expect(onChangeMock).toHaveBeenCalledWith({ sort: 'new' })
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('?provider= из старой ссылки — съёмный чип; сброс одной кнопкой', () => {
    renderBar({ ...EMPTY_FILTERS, provider: 'rg-1', q: 'sweet' }, 5)
    const providerChip = screen.getByRole('button', { name: 'Убрать фильтр RG provider' })
    fireEvent.click(providerChip)
    expect(onChangeMock).toHaveBeenCalledWith({ provider: '' })
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
})
