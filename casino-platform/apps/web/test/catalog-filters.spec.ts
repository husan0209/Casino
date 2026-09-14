/**
 * GAP-55: юнит-тесты фильтров каталога (ТЗ ч.5 §7 — «фильтры живут в URL»).
 * Проверяют то, что типы не ловят: пустые значения не протечки в API и в URL,
 * round-trip parse↔build, кодирование кириллицы, отсечение пустых категорий,
 * набор чипов главной (§6.1).
 */
import { describe, expect, it } from 'vitest'

import {
  buildHomeChips,
  catalogHref,
  EMPTY_FILTERS,
  filtersToApiParams,
  filtersToQuery,
  hasActiveFilters,
  nonEmptyCategories,
  parseFilters,
  SORT_OPTIONS,
} from '../src/lib/ui/catalog-filters'

describe('GAP-55 parseFilters (§7 фильтры в URL)', () => {
  it('читает category/provider/sort/q', () => {
    const parsed = parseFilters(new URLSearchParams('category=slots&provider=pragmatic&sort=popular&q=sweet'))
    expect(parsed).toEqual({ category: 'slots', provider: 'pragmatic', sort: 'popular', q: 'sweet' })
  })

  it('без параметров — пустые фильтры (не undefined)', () => {
    expect(parseFilters(new URLSearchParams(''))).toEqual(EMPTY_FILTERS)
  })

  it('round-trip: разобрали → собрали → получили тот же URL', () => {
    const original = new URLSearchParams('category=slots&sort=new&q=book')
    const filters = parseFilters(original)
    expect(parseFilters(new URLSearchParams(filtersToQuery(filters).slice(1)))).toEqual(filters)
  })
})

describe('GAP-55 маппинг фильтров в API', () => {
  it('пустые значения не отправляются (иначе «все» стало бы фильтром "")', () => {
    expect(filtersToApiParams(EMPTY_FILTERS)).toEqual({})
    expect(filtersToApiParams({ category: 'slots', provider: '', sort: '', q: '' })).toEqual({
      category: 'slots',
    })
  })

  it('q уходит в API под именем search', () => {
    expect(filtersToApiParams({ ...EMPTY_FILTERS, q: 'sweet' })).toEqual({ search: 'sweet' })
  })

  it('сортировка из UI-значений валидна для API (popular/new/name_asc)', () => {
    const values = SORT_OPTIONS.map((option) => option.value)
    expect(values).toEqual(['', 'popular', 'new', 'name_asc'])
  })
})

describe('GAP-55 сборка URL', () => {
  it('без фильтров — чистый /casino без знака вопроса', () => {
    expect(catalogHref({})).toBe('/casino')
    expect(filtersToQuery(EMPTY_FILTERS)).toBe('')
  })

  it('в URL попадают только непустые фильтры', () => {
    expect(catalogHref({ category: 'slots' })).toBe('/casino?category=slots')
    expect(catalogHref({ provider: 'pg-soft', sort: 'popular' })).toBe(
      '/casino?provider=pg-soft&sort=popular',
    )
  })

  it('кириллица и пробелы кодируются канонично (%20, а не +)', () => {
    expect(catalogHref({ q: 'книга мёртвых' })).toBe(`/casino?q=${encodeURIComponent('книга мёртвых')}`)
    expect(catalogHref({ q: 'book of dead' })).toBe('/casino?q=book%20of%20dead')
  })

  it('чтение терпит обе формы пробела (+ и %20) — старые ссылки не ломаются', () => {
    expect(parseFilters(new URLSearchParams('q=book+of+dead')).q).toBe('book of dead')
    expect(parseFilters(new URLSearchParams('q=book%20of%20dead')).q).toBe('book of dead')
  })

  it('спецсимволы не рвут запрос (&, =, #)', () => {
    const filters = { ...EMPTY_FILTERS, q: 'a&b=c#d' }
    expect(parseFilters(new URLSearchParams(filtersToQuery(filters).slice(1))).q).toBe('a&b=c#d')
  })

  it('hasActiveFilters — ложь только на полном сбросе', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false)
    expect(hasActiveFilters({ ...EMPTY_FILTERS, q: 'x' })).toBe(true)
    expect(hasActiveFilters({ ...EMPTY_FILTERS, sort: 'new' })).toBe(true)
  })
})

describe('GAP-55 пустые разделы и чипы (§6.1/§7)', () => {
  const categories = [
    { slug: 'slots', name: 'Слоты', game_count: 42 },
    { slug: 'live_casino', name: 'Live Казино', game_count: 0 },
    { slug: 'instant_games', name: 'Быстрые игры', game_count: 0 },
  ]

  it('категории без игр отсекаются — пустую категорию не показываем', () => {
    expect(nonEmptyCategories(categories).map((c) => c.slug)).toEqual(['slots'])
  })

  it('чипы главной = непустые категории + Популярные/Новые, все ведут в каталог', () => {
    const chips = buildHomeChips(categories)
    expect(chips.map((chip) => chip.label)).toEqual(['Слоты', 'Популярные', 'Новые'])
    expect(chips.map((chip) => chip.href)).toEqual([
      '/casino?category=slots',
      '/casino?sort=popular',
      '/casino?sort=new',
    ])
    for (const chip of chips) {
      expect(chip.href.startsWith('/casino')).toBe(true)
    }
  })

  it('при пустом списке категорий остаются только сортировочные чипы', () => {
    expect(buildHomeChips([])).toHaveLength(2)
  })
})
