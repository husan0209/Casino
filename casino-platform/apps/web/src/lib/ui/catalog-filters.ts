/**
 * GAP-55 (ТЗ ч.5 §7): фильтры каталога живут в URL —
 * `/casino?category=slots&provider=pragmatic-play&sort=popular&q=sweet`.
 *
 * Модуль чистый (конвенция GAP-44): разбирает/собирает query, маппит фильтры
 * в параметры API и строит ссылки для чипов главной (§6.1). Покрывается
 * тестами без jsdom.
 */

export interface CatalogFilters {
  category: string
  provider: string
  sort: string
  q: string
}

export const EMPTY_FILTERS: CatalogFilters = { category: '', provider: '', sort: '', q: '' }

/** Сортировка по ТЗ §7: Популярные | Новые | А–Я (значения валидны для API). */
export const SORT_OPTIONS: readonly { value: string; label: string }[] = [
  { value: '', label: 'По умолчанию' },
  { value: 'popular', label: 'Популярные' },
  { value: 'new', label: 'Новые' },
  { value: 'name_asc', label: 'А–Я' },
]

export function parseFilters(search: URLSearchParams): CatalogFilters {
  return {
    category: search.get('category') ?? '',
    provider: search.get('provider') ?? '',
    sort: search.get('sort') ?? '',
    q: search.get('q') ?? '',
  }
}

/** Пустые значения в API не отправляем (иначе фильтр «все» стал бы фильтром ''). */
export function filtersToApiParams(filters: CatalogFilters): Record<string, string | undefined> {
  return {
    ...(filters.category && { category: filters.category }),
    ...(filters.provider && { provider: filters.provider }),
    ...(filters.sort && { sort: filters.sort }),
    ...(filters.q && { search: filters.q }),
  }
}

/** Query-строка URL: пустые фильтры не пишем, чтобы ссылка оставалась чистой. */
function encodePair(key: string, value: string): string {
  return `${key}=${encodeURIComponent(value)}`
}

/**
 * Собираем вручную (не URLSearchParams.toString!): последний кодирует пробел
 * как '+', что двусмысленно для парсеров (qs/`decodeURIComponent`), а ссылки
 * каталога шарятся и попадают в SEO — нужен каноничный %20.
 * Читаем через URLSearchParams (он понимает обе формы) — round-trip сохранён.
 */
export function filtersToQuery(filters: CatalogFilters): string {
  const pairs: string[] = []
  if (filters.category) {
    pairs.push(encodePair('category', filters.category))
  }
  if (filters.provider) {
    pairs.push(encodePair('provider', filters.provider))
  }
  if (filters.sort) {
    pairs.push(encodePair('sort', filters.sort))
  }
  if (filters.q) {
    pairs.push(encodePair('q', filters.q))
  }
  return pairs.length > 0 ? `?${pairs.join('&')}` : ''
}

export function catalogHref(filters: Partial<CatalogFilters>): string {
  return `/casino${filtersToQuery({ ...EMPTY_FILTERS, ...filters })}`
}

export function hasActiveFilters(filters: CatalogFilters): boolean {
  return Boolean(filters.category || filters.provider || filters.sort || filters.q)
}

/** Категория с нулём игр в релизе не показываем (ТЗ §7 «пустую категорию не показывать»). */
export interface CatalogCategory {
  slug: string
  name: string
  game_count: number
}

export function nonEmptyCategories(categories: CatalogCategory[]): CatalogCategory[] {
  return categories.filter((category) => category.game_count > 0)
}

/** Счётчик каталога (§4.6 «Найдено N») с русским склонением. */
export function foundLabel(total: number): string {
  const n = Math.abs(total) % 100
  const last = n % 10
  const form =
    n > 10 && n < 20 ? 'игр' : last === 1 ? 'игра' : last > 1 && last < 5 ? 'игры' : 'игр'
  return `Найдено ${total} ${form}`
}

/**
 * Сортировочные чипы (§4.6): идут после категорий, перед «Избранным».
 * Одни и те же чипы живут в баре каталога и на главной — порядок держим в одном месте.
 */
export const CATALOG_SORT_CHIPS: readonly { label: string; sort: string }[] = [
  { label: 'Новые', sort: 'new' },
  { label: 'Популярные', sort: 'popular' },
]

/**
 * Чипы главной (§6.1 п.2): «Все» первым (§6: порядок без «Все» — баг донора),
 * затем непустые категории и сортировочные Новые/Популярные.
 * Пустые категории сюда не попадают (см. nonEmptyCategories).
 */
export function buildHomeChips(categories: CatalogCategory[]): { label: string; href: string }[] {
  const categoryChips = nonEmptyCategories(categories).map((category) => ({
    label: category.name,
    href: catalogHref({ category: category.slug }),
  }))
  const sortChips = CATALOG_SORT_CHIPS.map((chip) => ({
    label: chip.label,
    href: catalogHref({ sort: chip.sort }),
  }))
  return [{ label: 'Все', href: catalogHref({}) }, ...categoryChips, ...sortChips]
}
