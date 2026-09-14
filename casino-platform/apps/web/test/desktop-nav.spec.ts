/**
 * GAP-54: юнит-тесты чистой логики десктоп-навигации и поиска (ТЗ ч.5 §4.4/§4.5/§4.7).
 * Спека в node-окружении: без jsdom, проверяет контракты, которые типы не ловят —
 * набор пунктов релиза, правило активности, границы auth-путей и шортката.
 */
import { describe, expect, it } from 'vitest'

import {
  isAuthPath,
  isNavActive,
  NAV_ITEMS,
  isSearchShortcut,
  searchHref,
} from '../src/lib/ui/desktop-nav'

describe('GAP-54: десктоп-панель (§4.5)', () => {
  it('пункты релиза — ровно список ТЗ, в его порядке', () => {
    expect(NAV_ITEMS.map((item) => item.href)).toEqual([
      '/',
      '/casino',
      '/favorites',
      '/providers',
      '/wallet',
      '/history',
      '/support',
    ])
    expect(NAV_ITEMS.map((item) => item.label)).toEqual([
      'Главная',
      'Казино',
      'Избранное',
      'Провайдеры',
      'Кошелёк',
      'История',
      'Поддержка',
    ])
  })

  it('в панели нет разделов, запрещённых для релиза (ТЗ §24)', () => {
    const labels = NAV_ITEMS.map((item) => item.label.toLowerCase()).join(' ')
    for (const banned of ['live', 'настольн', 'быстрые', 'бонус']) {
      expect(labels).not.toContain(banned)
    }
  })

  it('каждый пункт имеет подпись и иконку (панель узкая, подписи по hover)', () => {
    for (const item of NAV_ITEMS) {
      expect(item.label.length).toBeGreaterThan(0)
      expect(item.icon.length).toBeGreaterThan(0)
    }
  })
})

describe('GAP-54: активность пункта (§4.5)', () => {
  it('главная активна только на точном /', () => {
    expect(isNavActive('/', '/')).toBe(true)
    expect(isNavActive('/casino', '/')).toBe(false)
  })

  it('раздел активен на своей странице и во вложенных маршрутах', () => {
    expect(isNavActive('/casino', '/casino')).toBe(true)
    expect(isNavActive('/casino/sweet-bonanza', '/casino')).toBe(true)
    expect(isNavActive('/wallet/transactions', '/wallet')).toBe(true)
  })

  it('соседний маршрут с тем же префиксом не делает пункт активным', () => {
    expect(isNavActive('/casinonext', '/casino')).toBe(false)
    expect(isNavActive('/wallets', '/wallet')).toBe(false)
  })
})

describe('GAP-54: ссылка поиска (§4.4)', () => {
  it('пустой или мусорный запрос ведёт на чистый /search', () => {
    expect(searchHref('')).toBe('/search')
    expect(searchHref('   ')).toBe('/search')
  })

  it('запрос обрезается и кодируется (кириллица, пробелы, спецсимволы)', () => {
    expect(searchHref('  book of dead  ')).toBe('/search?q=book%20of%20dead')
    expect(searchHref('сладкие фрукты')).toBe(`/search?q=${encodeURIComponent('сладкие фрукты')}`)
    expect(searchHref('a&b')).toBe('/search?q=a%26b')
  })
})

describe('GAP-54: auth-страницы без казино-навигации (§4.7)', () => {
  it('маршруты (auth)-группы — bare', () => {
    expect(isAuthPath('/login')).toBe(true)
    expect(isAuthPath('/register')).toBe(true)
    expect(isAuthPath('/verify-email')).toBe(true)
    expect(isAuthPath('/forgot-password')).toBe(true)
    expect(isAuthPath('/reset-password')).toBe(true)
    expect(isAuthPath('/google/callback')).toBe(true)
  })

  it('витрина и кабинет — с навигацией; чужие префиксы не ловятся', () => {
    expect(isAuthPath('/')).toBe(false)
    expect(isAuthPath('/casino')).toBe(false)
    expect(isAuthPath('/profile')).toBe(false)
    expect(isAuthPath('/login-back')).toBe(false)
  })
})

describe('GAP-54: Ctrl/⌘K (§4.4)', () => {
  const event = (over: Record<string, unknown>): Parameters<typeof isSearchShortcut>[0] =>
    ({ key: 'k', metaKey: false, ctrlKey: false, target: null, ...over }) as never

  it('срабатывает на ctrl+k и meta+k', () => {
    expect(isSearchShortcut(event({ ctrlKey: true }))).toBe(true)
    expect(isSearchShortcut(event({ metaKey: true }))).toBe(true)
  })

  it('игнорирует другие комбинации и просто k', () => {
    expect(isSearchShortcut(event({}))).toBe(false)
    expect(isSearchShortcut(event({ ctrlKey: true, key: 'b' }))).toBe(false)
  })

  it('не срабатывает, пока фокус в поле ввода (иначе ломает набор текста)', () => {
    const input = { tagName: 'INPUT', isContentEditable: false }
    const textarea = { tagName: 'TEXTAREA', isContentEditable: false }
    const editable = { tagName: 'DIV', isContentEditable: true }
    expect(isSearchShortcut(event({ ctrlKey: true, target: input }))).toBe(false)
    expect(isSearchShortcut(event({ ctrlKey: true, target: textarea }))).toBe(false)
    expect(isSearchShortcut(event({ ctrlKey: true, target: editable }))).toBe(false)
  })
})
