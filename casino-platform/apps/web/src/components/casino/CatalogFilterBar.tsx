'use client'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { fetchCategories, fetchProviders } from '@/lib/api/casino.api'
import {
  hasActiveFilters,
  nonEmptyCategories,
  SORT_OPTIONS,
  type CatalogFilters,
} from '@/lib/ui/catalog-filters'

/**
 * GAP-55 (ТЗ ч.5 §7): фильтры каталога. Чипы категорий (пустые разделы не
 * показываем — данные приходят с game_count), сортировка, провайдер, поиск;
 * «сброс фильтров — одна кнопка», счётчик найденного обязателен.
 * Состояние — в URL (родитель), здесь только управление; поиск с debounce,
 * чтобы не дёргать API на каждый символ.
 */
const SEARCH_DEBOUNCE_MS = 300

export function CatalogFilterBar({
  filters,
  total,
  loading,
  onChange,
}: {
  filters: CatalogFilters
  total: number
  loading: boolean
  onChange: (patch: Partial<CatalogFilters>) => void
}): React.JSX.Element {
  const { data: categories } = useQuery({
    queryKey: ['casino-categories'],
    queryFn: () => fetchCategories(),
    staleTime: 5 * 60 * 1000,
  })
  const { data: providers } = useQuery({
    queryKey: ['providers-page'],
    queryFn: () => fetchProviders(),
    staleTime: 5 * 60 * 1000,
  })

  const [draft, setDraft] = useState(filters.q)

  // URL — источник истины: при сбросе/переходе по ссылке подтягиваем поле
  useEffect(() => {
    setDraft(filters.q)
  }, [filters.q])

  useEffect(() => {
    if (draft === filters.q) {
      return
    }
    const timer = setTimeout(() => onChange({ q: draft }), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [draft, filters.q, onChange])

  const categoryChips = nonEmptyCategories(categories ?? [])

  return (
    <div className="card mb-5 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onChange({ category: '' })}
          className={`rounded-full px-3 py-1.5 text-xs ${
            filters.category === '' ? 'bg-[#6C63FF] text-white' : 'text-muted hover:bg-white/5'
          }`}
        >
          Все
        </button>
        {categoryChips.map((category) => (
          <button
            key={category.slug}
            type="button"
            onClick={() => onChange({ category: category.slug })}
            className={`rounded-full px-3 py-1.5 text-xs ${
              filters.category === category.slug
                ? 'bg-[#6C63FF] text-white'
                : 'text-muted hover:bg-white/5'
            }`}
          >
            {category.name}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={filters.sort}
          onChange={(e) => onChange({ sort: e.target.value })}
          className="input w-auto"
          aria-label="Сортировка"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          value={filters.provider}
          onChange={(e) => onChange({ provider: e.target.value })}
          className="input w-auto"
          aria-label="Провайдер"
        >
          <option value="">Все провайдеры</option>
          {(providers ?? []).map((provider) => (
            <option key={provider.slug} value={provider.slug}>
              {provider.name}
            </option>
          ))}
        </select>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Поиск…"
          className="input w-56"
          aria-label="Поиск по каталогу"
        />
        {hasActiveFilters(filters) && (
          <button
            type="button"
            className="btn-ghost px-3 py-1.5 text-xs"
            onClick={() => onChange({ category: '', provider: '', sort: '', q: '' })}
          >
            Сбросить фильтры
          </button>
        )}
        <div className="ml-auto text-sm text-muted">
          {loading ? 'Загрузка…' : `${total} игр`}
        </div>
      </div>
    </div>
  )
}
