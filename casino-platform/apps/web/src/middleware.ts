import { type NextRequest, NextResponse } from 'next/server'

import { API_BASE_URL } from '@/lib/api-base'

/**
 * P1 #11 (остаток): CSP — Content-Security-Policy на каждый запрос.
 *
 * Про nonce и почему его тут нет. Канонический паттерн Next.js — генерировать
 * nonce в middleware и подставлять его в свои скрипты. Он требует динамического
 * рендеринга: nonce живёт в запросе, а статическая страница пререндерится на
 * сборке и лежит на диске уже без него. У нас 24 статических маршрута и 0
 * динамических, поэтому nonce в HTML не появляется НИ РАЗУ.
 *
 * Раньше здесь стоял `'strict-dynamic'`. По спецификации CSP L3 его присутствие
 * обязывает браузер игнорировать `'self'`, `https:` и `'unsafe-inline'`, так что
 * единственным разрешённым источником скриптов остаётся nonce. В сборке main
 * nonce не было ни в одном из 514 тегов <script> — то есть не выполнялся ни один
 * скрипт на сайте: ни гидратация, ни касса, ни кабинет партнёра.
 *
 * Политика сейчас соответствует режиму рендеринга: `'self'` для внешних
 * скриптов, `'unsafe-inline'` для инлайнового бутстрапа. Ужесточение (nonce
 * без `'unsafe-inline'`) требует `force-dynamic` на всех маршрутах — это отдельная
 * задача с замером TTFB, а не побочка к починке.
 *
 * nginx CSP для веб-хоста убран: два CSP-заголовка пересекаются браузером, и
 * политику должен задавать ровно один источник.
 */
export function middleware(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const isDev = process.env['NODE_ENV'] !== 'production'

  // В dev API кросс-доменный (дефолт API_BASE_URL = http://localhost:3001/api/v1 —
  // тот же, на который ходит клиент), и `connect-src 'self' https:` резал
  // браузерные запросы к нему до прихода на API («Network Error»). В проде API
  // same-origin за nginx — 'self' покрывает, поэтому origin API добавляется
  // только когда он реально другой.
  let apiOrigin = ''
  try {
    apiOrigin = new URL(API_BASE_URL).origin
  } catch {
    apiOrigin = ''
  }
  const connectSrc =
    apiOrigin && apiOrigin !== request.nextUrl.origin
      ? `'self' ${apiOrigin} https:`
      : `'self' https:`

  const cspHeader = [
    `default-src 'self'`,
    // 'self' — внешние скрипты (Next отдаёт их сам), 'unsafe-inline' — бутстрап.
    // 'strict-dynamic' здесь недопустим: он отключил бы и 'self', и 'unsafe-inline'
    // (см. докблок выше), а подставить nonce в статику нечем.
    `script-src 'self' 'unsafe-inline' https:${isDev ? " 'unsafe-eval'" : ''}`,
    // Next styled-jsx/глобальные стили: инлайновые <style> без nonce
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data: https:`,
    `font-src 'self'`,
    `connect-src ${connectSrc}`,
    // iframe игр и виджетов (Telegram/Google)
    `frame-src 'self' https:`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'self'`,
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ')

  const requestHeaders = new Headers(request.headers)
  // Next подставляет x-nonce в свои скрипты только на динамических маршрутах.
  // Сейчас их нет, поэтому заголовок ни на что не влияет — оставлен как опора для
  // перехода на force-dynamic, где nonce в политике станет обязательным.
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('content-security-policy', cspHeader)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('content-security-policy', cspHeader)
  return response
}

export const config = {
  // статика Next и файлы расширений — без nonce (не исполняют inline-скрипты)
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|uploads|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|txt|xml|css|js|woff2?)$).*)',
  ],
}
