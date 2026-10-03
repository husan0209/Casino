import { describe, expect, it } from 'vitest'

/**
 * Контракт «CSP ↔ режим рендеринга» для админки.
 *
 * Зачем существует этот спек: дефект d201c1e — в 'script-src' поставили
 * 'strict-dynamic', который по CSP L3 обязывает браузер игнорировать 'self' и
 * https:, остав единственным источником скрипта нонс. Сборка же была полностью
 * пререндеренной (514 тегов <script>, 0 нонсов) → в проде не исполнялся НИ ОДИН
 * скрипт, а все CI-гейты остались зелёными: ни линт, ни типами, ни smoke-тестом
 * браузерной политики это не проверялось.
 *
 * Отсюда инварианты, которые тут закреплены:
 *   1) пока маршруты пререндерятся, в script-src нет ни 'strict-dynamic', ни
 *      нонса-источника, но есть 'unsafe-inline' (иначе инлайновый бутстрап Next
 *      не исполняется и админка мертва);
 *   2) connect-src всегда включает origin API — vhost ADMIN_DOMAIN не проксирует
 *      /api/ (GAP-59), axios ходит на ДРУГОЙ origin, и политика без него убила
 *      бы каждый запрос админки тем же тихим способом;
 *   3) директивы не дублируются — при повторе браузер учитывает только первую,
 *      и «ужесточение» теряется молча.
 *
 * Чистая функция из lib/csp.ts тестируется без Edge-рантайма и без next/server,
 * поэтому спека идёт в обычном vitest-прогоне (@casino/admin test) и блокирует
 * PR до выкатки.
 */
import { API_URL as CLIENT_API_URL } from '../src/lib/api'
import { API_URL } from '../src/lib/api-base'
import { buildAdminCsp, buildConnectSrc, type CspInput } from '../src/lib/csp'

/** Прод-топология из docker-compose.prod.yml: админка на ADMIN_DOMAIN, API на DOMAIN. */
const PROD: CspInput = {
  apiBaseUrl: 'https://casino.example.com/api/v1',
  requestOrigin: 'https://admin.example.com',
  isDev: false,
}

function directives(csp: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const part of csp.split(';')) {
    const trimmed = part.trim()
    if (!trimmed) {
      continue
    }
    const name = trimmed.split(/\s+/)[0] ?? ''
    // Повтор директивы — отдельный дефект, ловится ниже; здесь не «последняя wins».
    if (!map.has(name)) {
      map.set(name, trimmed.slice(name.length).trim())
    }
  }
  return map
}

function names(csp: string): string[] {
  return csp
    .split(';')
    .map((part) => part.trim().split(/\s+/)[0] ?? '')
    .filter((name) => name.length > 0)
}

describe('admin CSP — режим рендеринга (регрессия d201c1e)', () => {
  it('прод-политика не содержит strict-dynamic', () => {
    expect(buildAdminCsp(PROD)).not.toContain('strict-dynamic')
  })

  it('прод-политика не содержит нонс-источник: в пререндеренном HTML нонса нет', () => {
    // 'nonce-...' — единственная форма нонса в CSP; появление без серверного
    // рендера скриптов = пустая страница.
    expect(buildAdminCsp(PROD)).not.toMatch(/'nonce-/)
  })

  it("script-src обязан разрешать 'unsafe-inline' — инлайновый бутстрап Next", () => {
    const scriptSrc = directives(buildAdminCsp(PROD)).get('script-src')
    expect(scriptSrc).toContain("'unsafe-inline'")
    expect(scriptSrc).toContain("'self'")
  })

  it("'unsafe-eval' только в dev (Next HMR), в проде его нет", () => {
    expect(buildAdminCsp(PROD)).not.toContain('unsafe-eval')
    expect(buildAdminCsp({ ...PROD, isDev: true })).toContain('unsafe-eval')
  })

  it('запрещённые источники исполняемого контента на месте', () => {
    const d = directives(buildAdminCsp(PROD))
    expect(d.get('object-src')).toBe(`'none'`)
    expect(d.get('frame-src')).toBe(`'none'`)
    expect(d.get('base-uri')).toBe(`'self'`)
    expect(d.get('form-action')).toBe(`'self'`)
  })

  it('frame-ancestors none согласован с X-Frame-Options: DENY на nginx-хосте', () => {
    expect(directives(buildAdminCsp(PROD)).get('frame-ancestors')).toBe(`'none'`)
  })

  it('upgrade-insecure-requests только в проде', () => {
    expect(buildAdminCsp(PROD)).toContain('upgrade-insecure-requests')
    expect(buildAdminCsp({ ...PROD, isDev: true })).not.toContain('upgrade-insecure-requests')
  })
})

describe('admin CSP — connect-src против кросс-origin API (GAP-59)', () => {
  it('кросс-origin API попадает в connect-src, иначе админка без единого запроса', () => {
    expect(buildConnectSrc(PROD)).toContain('https://casino.example.com')
  })

  it('same-origin API не плодит дублей', () => {
    const sameOrigin: CspInput = {
      apiBaseUrl: 'https://admin.example.com/api/v1',
      requestOrigin: 'https://admin.example.com',
      isDev: false,
    }
    const connectSrc = buildConnectSrc(sameOrigin)
    expect(connectSrc.match(/'self'/g)).toHaveLength(1)
    expect(connectSrc).not.toContain('https://admin.example.com')
  })

  it('некорректный NEXT_PUBLIC_API_URL не роняет middleware и не оставляет дыру', () => {
    const broken: CspInput = { ...PROD, apiBaseUrl: 'не-url' }
    expect(buildConnectSrc(broken)).toBe(`'self' https:`)
  })

  it('дефолт API совпадает с тем, что реально использует клиент', () => {
    // lib/api (axios) и lib/csp (connect-src) обязаны знать ОДИН URL: расхождение
    // двух независимых дефолтов режет запросы молча.
    expect(API_URL).toBe(CLIENT_API_URL)
  })
})

describe('admin CSP — структура заголовка', () => {
  it('директивы не повторяются (повтор браузер игнорирует начиная со второй)', () => {
    const list = names(buildAdminCsp(PROD))
    expect(new Set(list).size).toBe(list.length)
  })

  it('default-src первым и строго self', () => {
    const csp = buildAdminCsp(PROD)
    expect(csp.startsWith(`default-src 'self'`)).toBe(true)
  })

  it('dev-политика тоже валидна по структуре', () => {
    const dev: CspInput = {
      ...PROD,
      isDev: true,
      apiBaseUrl: 'http://localhost:3001/api/v1',
      requestOrigin: 'http://localhost:3002',
    }
    const list = names(buildAdminCsp(dev))
    expect(new Set(list).size).toBe(list.length)
  })
})
