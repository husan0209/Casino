'use client'

import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'

import { fetchCategories, fetchProviders } from '@/lib/api/casino.api'
import {
  CATALOG_SORT_CHIPS,
  foundLabel,
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

/** Чип категории: активный — брендовая заливка, §4.6 «Все» всегда первым. */
function chipClass(active: boolean): string {
  return `shrink-0 rounded-full border px-3 py-1.5 text-xs transition ${
    active
      ? 'border-[#6C63FF] bg-[#6C63FF] font-semibold text-white'
      : 'border-[#2A2A4A] text-muted hover:border-[#6C63FF]/40 hover:text-white'
  }`
}

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
  const [sheet, setSheet] = useState(false)
  const activeCount = [filters.sort, filters.provider, filters.category, filters.q].filter(
    (value) => value.length > 0,
  ).length

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
  const allCount = total || categoryChips.reduce((sum, category) => sum + category.game_count, 0)

  return (
    <div className="mb-5 space-y-3">
      {/* §4.6: чипы живым рядом, без рамки-панели; на телефоне — горизонтальный скролл */}
      <div className="scrollbar-hide -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        <button
          type="button"
          onClick={() => onChange({ category: '' })}
          className={chipClass(filters.category === '')}
        >
          Все
          <span className={filters.category === '' ? 'ml-1 text-white/70' : 'ml-1 text-white/30'}>
            {allCount}
          </span>
        </button>
        {categoryChips.map((category) => {
          const active = filters.category === category.slug
          return (
            <button
              key={category.slug}
              type="button"
              onClick={() => onChange({ category: category.slug })}
              className={chipClass(active)}
            >
              {category.name}
              <span className={active ? 'ml-1 text-white/70' : 'ml-1 text-white/30'}>
                {category.game_count}
              </span>
            </button>
          )
        })}
        {/* §4.6: после категорий — сортировочные чипы и «Избранное» */}
        {CATALOG_SORT_CHIPS.map((chip) => {
          const active = filters.sort === chip.sort
          return (
            <button
              key={chip.sort}
              type="button"
              onClick={() => onChange({ sort: active ? '' : chip.sort })}
              className={chipClass(active)}
            >
              {chip.label}
            </button>
          )
        })}
        <Link href="/favorites" className={chipClass(false)}>
          Избранное
        </Link>
      </div>

      {/* §7: на телефоне фильтры — чипы категорий + bottom-sheet «Фильтры» */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-ghost px-3 py-1.5 text-xs md:hidden"
          onClick={() => setSheet(true)}
        >
          Фильтры{activeCount > 0 ? ` · ${String(activeCount)}` : ''}
        </button>

        {/* поиск — доступен и на телефоне, и на десктопе */}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Найти игру или провайдера"
          className="input w-full min-w-40 flex-1 md:w-56 md:flex-none"
          aria-label="Поиск по каталогу"
        />

        {/* на десктопе сортировка и провайдер — прямо в панели фильтров */}
        <div className="hidden flex-wrap items-center gap-3 md:flex">
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
        </div>

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
          {loading ? 'Загрузка…' : foundLabel(total)}
        </div>
      </div>

      {sheet && (
        <>
          <div className="sheet-backdrop" onClick={() => setSheet(false)} />
          <div className="sheet-panel space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Фильтры</h2>
              <button
                type="button"
                onClick={() => setSheet(false)}
                aria-label="Закрыть"
                className="rounded-lg p-1.5 text-muted transition hover:bg-white/5 hover:text-white"
              >
                <X size={18} aria-hidden />
              </button>
            </div>
            <label className="block space-y-1 text-sm">
              <span className="text-muted">Сортировка</span>
              <select
                value={filters.sort}
                onChange={(e) => onChange({ sort: e.target.value })}
                className="input"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 text-sm">
              <span className="text-muted">Провайдер</span>
              <select
                value={filters.provider}
                onChange={(e) => onChange({ provider: e.target.value })}
                className="input"
              >
                <option value="">Все провайдеры</option>
                {(providers ?? []).map((provider) => (
                  <option key={provider.slug} value={provider.slug}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn w-full" onClick={() => setSheet(false)}>
              Готово
            </button>
          </div>
        </>
      )}
    </div>
  )
}
