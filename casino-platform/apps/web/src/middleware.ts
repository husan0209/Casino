import { type NextRequest, NextResponse } from 'next/server'

import { API_BASE_URL } from '@/lib/api-base'
import { buildWebCsp } from '@/lib/csp'

/**
 * P1 #11 (остаток): CSP на каждый запрос. Политика живёт в lib/csp.ts — чистой
 * функцией, чтобы её можно было проверить юнит-спеком (apps/web/test/csp.spec.ts)
 * и не ловить «заголовок поменялся, а гейты зелёные». Почему здесь нет nonce и
 * 'strict-dynamic' — докблок там же (дефект d201c1e).
 *
 * nginx CSP для веб-хоста убран: два CSP-заголовка пересекаются браузером, и
 * политику должен задавать ровно один источник.
 */
export function middleware(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const cspHeader = buildWebCsp({
    apiBaseUrl: API_BASE_URL,
    requestOrigin: request.nextUrl.origin,
    isDev: process.env['NODE_ENV'] !== 'production',
  })

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
