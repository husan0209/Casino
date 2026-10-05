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
 * Пункты десктоп-панели — список релиза ТЗ §4.5.
 * Live / Настольные / Быстрые / Бонусы не добавляем (ТЗ §24).
 * icon — ключ в маппинге NAV_ICONS (components/layout/nav-icon.tsx),
 * не эмодзи: иконки UI — только lucide (ТЗ ч.5.1 §6).
 *
 * «Партнёрам» — вход в партнёрскую программу для вебмастеров (ТЗ ч.8).
 * Это НЕ игровая рефералка: другой контрагент (внешний вебмастер, а не
 * пригласивший игрока) и другие правила — расчёт от NGR, кабинет отдельный.
 * Поэтому в меню подписано «Партнёрам», а не «Рефералы», чтобы игроки не
 * путали две разные программы.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Главная', icon: 'home' },
  { href: '/casino', label: 'Казино', icon: 'casino' },
  { href: '/favorites', label: 'Избранное', icon: 'heart' },
  { href: '/providers', label: 'Провайдеры', icon: 'puzzle' },
  { href: '/wallet', label: 'Кошелёк', icon: 'wallet' },
  { href: '/history', label: 'История', icon: 'history' },
  { href: '/affiliate', label: 'Партнёрам', icon: 'handshake' },
  { href: '/support', label: 'Поддержка', icon: 'chat' },
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

/**
 * GAP-49: правовые документы рендерятся в нейтральной обвязке (`LegalChrome`) —
 * без бренда, тэглайна, платёжных бейджей и казино-навигации. Юридический текст
 * не должен быть оформлен как рекламная страница и не должен содержать данных
 * об операторе, пока реквизиты не утверждены (docs/LEGAL_COMPLIANCE.md §2).
 */
export const LEGAL_PATHS: readonly string[] = ['/legal']

export function isLegalPath(pathname: string): boolean {
  return LEGAL_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

/** §4.4: Ctrl/⌘ K открывает поиск. Игнорируем, пока фокус в поле ввода. */
export function isSearchShortcut(event: {
  // `key` опционален не для красоты: синтетические keydown от расширений приходят
  // с metaKey/ctrlKey, но без него, и `event.key.toLowerCase()` рвал обработчик.
  key?: string
  metaKey: boolean
  ctrlKey: boolean
  target?: EventTarget | null
}): boolean {
  // key отсутствует у синтетических keydown, которые шлют расширения браузера:
  // без проверки typeof падаем на undefined.toLowerCase() и рвём обработчик.
  const pressedKey = typeof event.key === 'string' ? event.key.toLowerCase() : ''
  if (pressedKey !== 'k' || !(event.metaKey || event.ctrlKey)) {
    return false
  }
  const element = event.target as HTMLElement | null
  const tag = element?.tagName ?? ''
  const typingHere = tag === 'INPUT' || tag === 'TEXTAREA' || element?.isContentEditable === true
  return !typingHere
}