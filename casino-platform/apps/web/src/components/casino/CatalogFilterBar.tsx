'use client'

import { useQuery } from '@tanstack/react-query'
import { ArrowUpDown, Check, ChevronDown, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { fetchCategories, fetchProviders } from '@/lib/api/casino.api'
import {
  hasActiveFilters,
  nonEmptyCategories,
  SORT_OPTIONS,
  type CatalogCategory,
  type CatalogFilters,
} from '@/lib/ui/catalog-filters'
import { pickProviderColor } from '@/lib/ui/provider-colors'
import type { ProviderDto } from '@/types/casino'

/**
 * GAP-55 (ТЗ ч.5 §7): фильтры каталога. Чипы категорий (пустые не показываем),
 * поиск с иконкой и очисткой, сортировка — кастомный дропдаун, провайдеры —
 * горизонтальная лента чипов с аватарками (паттерн лобби 2024: нативные select
 * с десятками неотличимых опций не читаются). Активные фильтры — съёмные чипы
 * + «Сбросить фильтры» одной кнопкой (§7), счётчик найденного обязателен.
 * Состояние — в URL (родитель), здесь только управление; поиск с debounce.
 * На телефоне — bottom sheet «Фильтры» с теми же чипами (§7, не сайдбар).
 */
const SEARCH_DEBOUNCE_MS = 300

/** Сортировка: кастомный дропдаун вместо нативного select (стиль темы). */
function SortDropdown({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    const onDown = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = SORT_OPTIONS.find((option) => option.value === value) ?? SORT_OPTIONS[0]!

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="input flex items-center gap-2 py-1.5 text-xs"
      >
        <ArrowUpDown size={14} className="text-muted" aria-hidden />
        {current.label}
        <ChevronDown size={14} className="text-muted" aria-hidden />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-40 mt-1 w-44 overflow-hidden rounded-xl border border-[#2A2A4A]/60 bg-[#1A1A2E] shadow-xl shadow-black/30"
        >
          {SORT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
              className="flex w-full items-center justify-between px-3 py-2 text-xs text-white/80 transition hover:bg-white/5"
            >
              {option.label}
              {option.value === value && <Check size={14} className="text-money" aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Провайдеры: горизонтальная лента чипов с аватарками-буквами (или логотипом). */
function ProviderChipsRow({
  providers,
  active,
  onSelect,
}: {
  providers: ProviderDto[]
  active: string
  onSelect: (slug: string) => void
}): React.JSX.Element {
  const chipClass = (selected: boolean): string =>
    `flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
      selected
        ? 'border-[#6C63FF] bg-[#6C63FF]/15 text-white'
        : 'border-[#2A2A4A]/70 text-muted hover:border-[#6C63FF]/40 hover:text-white'
    }`

  return (
    <div
      role="group"
      aria-label="Провайдеры"
      className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <button
        type="button"
        onClick={() => onSelect('')}
        aria-pressed={active === ''}
        className={chipClass(active === '')}
      >
        Все провайдеры
      </button>
      {providers.map((provider) => {
        const color = pickProviderColor(provider.name)
        return (
          <button
            key={provider.slug}
            type="button"
            onClick={() => onSelect(provider.slug)}
            aria-pressed={active === provider.slug}
            className={chipClass(active === provider.slug)}
          >
            {provider.logo_url ? (
              <img src={provider.logo_url} alt="" className="h-4 w-4 rounded-full object-cover" />
            ) : (
              <span
                aria-hidden
                className={`grid h-4 w-4 place-items-center rounded-full text-[9px] font-black text-white ${color.icon}`}
              >
                {provider.name.charAt(0).toUpperCase()}
              </span>
            )}
            {provider.name}
          </button>
        )
      })}
    </div>
  )
}

/** Активные фильтры — съёмные чипы (§7: сброс остаётся одной кнопкой). */
function ActiveFilterChips({
  filters,
  categories,
  providers,
  onChange,
}: {
  filters: CatalogFilters
  categories: CatalogCategory[]
  providers: ProviderDto[]
  onChange: (patch: Partial<CatalogFilters>) => void
}): React.JSX.Element | null {
  if (!hasActiveFilters(filters)) {
    return null
  }
  const categoryName = categories.find((c) => c.slug === filters.category)?.name
  const providerName = providers.find((p) => p.slug === filters.provider)?.name
  const sortLabel = SORT_OPTIONS.find((o) => o.value === filters.sort)?.label

  const chip =
    'flex items-center gap-1 rounded-full border border-[#6C63FF]/40 bg-[#6C63FF]/10 py-1 pl-2.5 pr-1 text-xs text-white/90'
  const xButton =
    'grid h-4 w-4 place-items-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white'

  const chips: Array<{ key: string; label: string; clear: Partial<CatalogFilters> }> = []
  if (filters.q) {
    chips.push({ key: 'q', label: `«${filters.q}»`, clear: { q: '' } })
  }
  if (filters.category && categoryName) {
    chips.push({ key: 'category', label: categoryName, clear: { category: '' } })
  }
  if (filters.provider && providerName) {
    chips.push({ key: 'provider', label: providerName, clear: { provider: '' } })
  }
  if (filters.sort && sortLabel) {
    chips.push({ key: 'sort', label: sortLabel, clear: { sort: '' } })
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Активные фильтры">
      {chips.map((chipItem) => (
        <span key={chipItem.key} className={chip}>
          {chipItem.label}
          <button
            type="button"
            aria-label={`Убрать фильтр ${chipItem.label}`}
            className={xButton}
            onClick={() => onChange(chipItem.clear)}
          >
            <X size={11} aria-hidden />
          </button>
        </span>
      ))}
      <button
        type="button"
        className="btn-ghost px-2.5 py-1 text-xs"
        onClick={() => onChange({ category: '', provider: '', sort: '', q: '' })}
      >
        Сбросить всё
      </button>
    </div>
  )
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
  const chipClass = (selected: boolean): string =>
    `rounded-full px-3 py-1.5 text-xs ${
      selected ? 'bg-[#6C63FF] text-white' : 'text-muted hover:bg-white/5'
    }`

  return (
    <div className="card mb-5 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onChange({ category: '' })}
          className={chipClass(filters.category === '')}
        >
          Все
        </button>
        {categoryChips.map((category) => (
          <button
            key={category.slug}
            type="button"
            onClick={() => onChange({ category: category.slug })}
            className={chipClass(filters.category === category.slug)}
          >
            {category.name}
          </button>
        ))}
      </div>

      {/* поиск — с иконкой и очисткой; сортировка — кастомный дропдаун */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
          <Search
            size={14}
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Поиск по названию…"
            aria-label="Поиск по каталогу"
            className="input pl-8 pr-8"
          />
          {draft !== '' && (
            <button
              type="button"
              onClick={() => setDraft('')}
              aria-label="Очистить поиск"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted transition hover:text-white"
            >
              <X size={14} aria-hidden />
            </button>
          )}
        </div>
        <SortDropdown value={filters.sort} onChange={(sort) => onChange({ sort })} />
        <div className="ml-auto text-sm text-muted">
          {loading ? 'Загрузка…' : `${total} игр`}
        </div>
      </div>

      {/* провайдеры — лента чипов (паттерн лобби 2024 вместо нативного select) */}
      <ProviderChipsRow
        providers={providers ?? []}
        active={filters.provider}
        onSelect={(provider) => onChange({ provider })}
      />

      <ActiveFilterChips
        filters={filters}
        categories={categories ?? []}
        providers={providers ?? []}
        onChange={onChange}
      />

      {/* §7: на телефоне фильтры дублируются в bottom sheet */}
      <button
        type="button"
        className="btn-ghost w-full py-1.5 text-xs md:hidden"
        onClick={() => setSheet(true)}
      >
        Фильтры{activeCount > 0 ? ` · ${String(activeCount)}` : ''}
      </button>

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
                className="text-muted"
              >
                ✕
              </button>
            </div>
            <div className="space-y-1.5">
              <p className="caps-label">Сортировка</p>
              <div className="flex flex-wrap gap-1.5">
                {SORT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => onChange({ sort: option.value })}
                    className={chipClass(filters.sort === option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="caps-label">Провайдеры</p>
              <div className="flex max-h-52 flex-wrap gap-1.5 overflow-y-auto">
                <button
                  type="button"
                  onClick={() => onChange({ provider: '' })}
                  className={chipClass(filters.provider === '')}
                >
                  Все
                </button>
                {(providers ?? []).map((provider) => (
                  <button
                    key={provider.slug}
                    type="button"
                    onClick={() => onChange({ provider: provider.slug })}
                    className={chipClass(filters.provider === provider.slug)}
                  >
                    {provider.name}
                  </button>
                ))}
              </div>
            </div>
            <button type="button" className="btn w-full" onClick={() => setSheet(false)}>
              Готово
            </button>
          </div>
        </>
      )}
    </div>
  )
}
