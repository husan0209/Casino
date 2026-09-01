import { type NextRequest, NextResponse } from 'next/server'

/**
 * P1 #11 (остаток): nonce-CSP — строгая Content-Security-Policy на каждый запрос.
 *
 * Паттерн из документации Next.js: middleware генерирует nonce, кладёт CSP
 * и в request-headers (Next сам подставит nonce в свои inline/hydration-скрипты),
 * и в response. `'strict-dynamic'` пропускает скрипты, вставленные доверенными;
 * `'unsafe-inline'` остаётся как fallback для старых браузеров без strict-dynamic
 * (игнорируется ими же при наличии nonce). `unsafe-eval` нужен только в dev (HMR).
 *
 * nginx CSP для веб-хоста убран: два CSP-заголовка пересекаются браузером,
 * strict-dynamic не пробьёт внешний 'unsafe-inline'-CSP (см. casino.conf).
 */
export function middleware(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const isDev = process.env['NODE_ENV'] !== 'production'

  const cspHeader = [
    `default-src 'self'`,
    // 'unsafe-inline' в script-src — совместимость со старыми браузерами;
    // современные применяют nonce+strict-dynamic и его игнорируют
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https: 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
    // Next styled-jsx/глобальные стили: инлайновые <style> без nonce
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data: https:`,
    `font-src 'self'`,
    `connect-src 'self' https:`,
    // iframe игр и виджетов (Telegram/Google)
    `frame-src 'self' https:`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'self'`,
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ')

  const requestHeaders = new Headers(request.headers)
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
