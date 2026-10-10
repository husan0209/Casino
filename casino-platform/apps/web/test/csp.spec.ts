import { describe, expect, it } from 'vitest'

import { buildFrameAncestors, buildWebCsp } from '@/lib/csp'

/**
 * CSP публичного хоста разбирается по директивам: заголовок — это текст, и
 * «одна лишняя кавычка» в нём не роняет ни сборку, ни тесты страниц, но
 * ломает и отображение сайта, и Mini App внутри Telegram.
 */

const PROD_INPUT = {
  apiBaseUrl: 'https://casino.example/api/v1',
  requestOrigin: 'https://casino.example',
  isDev: false,
}

function directives(policy: string): Record<string, string> {
  const parsed: Record<string, string> = {}
  for (const part of policy.split('; ')) {
    const separator = part.indexOf(' ')
    if (separator < 0) {
      parsed[part] = ''
      continue
    }
    parsed[part.slice(0, separator)] = part.slice(separator + 1)
  }
  return parsed
}

describe('buildWebCsp', () => {
  it('frame-ancestors: каждый источник отдельным токеном', () => {
    const policy = directives(buildWebCsp(PROD_INPUT))

    expect(policy['frame-ancestors']).toBe(
      `'self' https://telegram.org https://*.telegram.org https://web.telegram.org`,
    )
  })

  /**
   * Расширение под Mini App не превращается в «встраивайся кто угодно»:
   * clickjacking на платёжном сайте стоит денег.
   */
  it('frame-ancestors не отпускает произвольный https и не забывает про себя', () => {
    const sources = buildFrameAncestors().split(' ')

    expect(sources).toContain(`'self'`)
    expect(sources).not.toContain('https:')
    expect(sources).not.toContain('*')
  })

  /**
   * Регресс d201c1e: 'strict-dynamic' обязывает браузер игнорировать 'self' и
   * 'unsafe-inline', а nonce в пререндеренный статику подставить нечем — сайт
   * оставался без единого исполняемого скрипта при зелёных гейтах.
   */
  it('script-src остаётся пригодным для статической сборки', () => {
    const policy = directives(buildWebCsp(PROD_INPUT))

    expect(policy['script-src']).toContain(`'unsafe-inline'`)
    expect(policy['script-src']).not.toContain('strict-dynamic')
    // скрипт Mini App (telegram.org/js/telegram-web-app.js) обязан проходить
    expect(policy['script-src']).toContain('https:')
  })

  it('frame-src не сужен: игры провайдера едут в iframe', () => {
    expect(directives(buildWebCsp(PROD_INPUT))['frame-src']).toBe(`'self' https:`)
  })

  it('same-origin API не дублируется в connect-src, чужой — добавляется', () => {
    expect(directives(buildWebCsp(PROD_INPUT))['connect-src']).toBe(`'self' https:`)

    const crossDomain = buildWebCsp({
      apiBaseUrl: 'http://localhost:3001/api/v1',
      requestOrigin: 'http://localhost:3000',
      isDev: true,
    })
    expect(directives(crossDomain)['connect-src']).toBe(`'self' http://localhost:3001 https:`)
  })

  it('dev добавляет unsafe-eval, прод добавляет upgrade-insecure-requests', () => {
    const dev = buildWebCsp({ ...PROD_INPUT, isDev: true })
    const prod = buildWebCsp(PROD_INPUT)

    expect(dev).toContain(`'unsafe-eval'`)
    expect(prod).not.toContain(`'unsafe-eval'`)
    expect(prod).toContain('upgrade-insecure-requests')
    expect(dev).not.toContain('upgrade-insecure-requests')
  })
})
