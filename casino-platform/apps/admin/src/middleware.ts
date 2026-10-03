import { type NextRequest, NextResponse } from 'next/server'

import { API_URL } from '@/lib/api-base'
import { buildAdminCsp } from '@/lib/csp'

/**
 * CSP для админки — на каждый запрос. Перенос подхода apps/web/src/middleware.ts.
 *
 * До этой правки CSP у админки не было ВООБЩЕ: middleware.ts отсутствовал, а
 * nginx-хост ADMIN_DOMAIN отдавал только X-Frame-Options/nosniff/HSTS (см.
 * infra/nginx/templates/casino.conf.template). Админка — панель с финансовыми
 * операциями и KYC, публичный веб был защищён строже, чем она.
 *
 * Политика собирается в lib/csp.ts (чистая функция) и покрыта
 * apps/admin/test/csp.spec.ts — специально, чтобы несоответствие политики
 * режиму рендеринга ловилось гейтом, а не прод-выкаткой. Дефект d201c1e:
 * 'strict-dynamic' при полностью пререндеренном HTML (нонсов в нём 0) оставил
 * сайт без исполняемых скриптов, и ни один CI-чек этого не поймал. Отсюда
 * правило: сюда нонс/'strict-dynamic' не возвращать, пока маршруты не станут
 * динамическими.
 *
 * Нонс здесь не генерируем и заголовок `x-nonce` не проставляем даже «про
 * будущее» (в веб-хосте он остался как заготовка): в статической сборке он ни
 * на что не влияет, а его наличие провоцирует добавить 'strict-dynamic'.
 */
export function middleware(request: NextRequest): NextResponse {
  const cspHeader = buildAdminCsp({
    apiBaseUrl: API_URL,
    requestOrigin: request.nextUrl.origin,
    isDev: process.env['NODE_ENV'] !== 'production',
  })

  const response = NextResponse.next()
  response.headers.set('content-security-policy', cspHeader)
  return response
}

export const config = {
  // Статика Next и файлы-ресурсы не исполняют инлайновых скриптов — заголовок
  // на них только раздувает ответ.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|txt|xml|css|js|woff2?)$).*)',
  ],
}
