/**
 * GAP-54 (ТЗ ч.5 §4.5/§4.4): чистые helpers десктоп-навигации и поиска.
 * Вынесено из компонентов по конвенции GAP-44 («компоненты — глупый рендер,
 * логика — в чистых функциях, которые тестируются без jsdom»).
 */

export interface NavItem {
  href: string
  label: string
  icon: string
}

/**
 * Пункты десктоп-панели — ровно список релиза ТЗ §4.5.
 * Live / Настольные / Быстрые / Бонусы не добавляем (ТЗ §24).
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Главная', icon: '🏠' },
  { href: '/casino', label: 'Казино', icon: '🎰' },
  { href: '/favorites', label: 'Избранное', icon: '♥' },
  { href: '/providers', label: 'Провайдеры', icon: '🧩' },
  { href: '/wallet', label: 'Кошелёк', icon: '👛' },
  { href: '/history', label: 'История', icon: '🕘' },
  { href: '/support', label: 'Поддержка', icon: '💬' },
]

/**
 * Активный пункт: главная — только точный '/', остальные — по префиксу
 * сегмента ('/casino/sweet-bonanza' → активен 'Казино', '/casinoXYZ' — нет).
 */
export function isNavActive(pathname: string, href: string): boolean {
  if (href === '/') {
    return pathname === '/'
  }
  return pathname === href || pathname.startsWith(`${href}/`)
}

/** Ссылка на экран поиска с запросом (§4.4 — глобальный поиск отдельным экраном). */
export function searchHref(query: string): string {
  const trimmed = query.trim()
  return trimmed.length > 0 ? `/search?q=${encodeURIComponent(trimmed)}` : '/search'
}

/**
 * §4.7: на страницах аутентификации нет казино-навигации (хедер, футер,
 * таббар, икон-панель). Список префиксов — маршрут (auth)-группы.
 */
export const AUTH_PATHS: readonly string[] = [
  '/login',
  '/register',
  '/verify-email',
  '/forgot-password',
  '/reset-password',
  '/google/callback',
]

export function isAuthPath(pathname: string): boolean {
  return AUTH_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

/** §4.4: Ctrl/⌘ K открывает поиск. Игнорируем, пока фокус в поле ввода. */
export function isSearchShortcut(event: {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  target?: EventTarget | null
}): boolean {
  if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey)) {
    return false
  }
  const element = event.target as HTMLElement | null
  const tag = element?.tagName ?? ''
  const typingHere = tag === 'INPUT' || tag === 'TEXTAREA' || element?.isContentEditable === true
  return !typingHere
}
