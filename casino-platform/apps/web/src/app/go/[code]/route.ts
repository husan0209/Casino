import { type NextRequest, NextResponse } from 'next/server'

import { API_BASE_URL } from '@/lib/api-base'

/**
 * Точка входа партнёрской ссылки: `https://<домен>/go/{tracking_code}`.
 *
 * ПОЧЕМУ ПРОКСИ, А НЕ ПРЯМОЙ РЕДИРЕКТ НА API: трекинг должен видеть реальный
 * IP и User-Agent посетителя, иначе антифрод (F1/F2 — самопривлечение) и
 * cookie-окно атрибуции работают неверно. Серверный fetch из веба отдавал бы
 * IP веб-контейнера, и все посетители выглядели бы одним клиентом.
 *
 * Поэтому браузер уводится на API-эндпоинт `/go/:code` напрямую: запрос идёт
 * от пользователя, API ставит cookie `aff_code` и возвращает 302 на витрину.
 *
 * РЕДИРЕКТ ОТ API АБСОЛЮТНЫЙ (см. affiliate-tracking.controller): если бы он
 * был относительным, браузер разрешил бы `/casino` относительно origin API и
 * увёл игрока не туда.
 */
export const dynamic = 'force-dynamic'

/** Параметры deep-link, которые пробрасываем партнёру. */
const TRACKED_QUERY_KEYS = ['p', 'c', 's'] as const

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ code: string }> },
): Promise<NextResponse> {
  const { code } = await context.params
  const incoming = request.nextUrl.searchParams

  const target = new URL(`${API_BASE_URL.replace(/\/+$/, '')}/go/${encodeURIComponent(code)}`)
  for (const key of TRACKED_QUERY_KEYS) {
    const value = incoming.get(key)
    if (value !== null && value !== '') {
      target.searchParams.set(key, value)
    }
  }

  // 307: сохраняем метод, но для GET это обычный редирект. Явно НЕ 302 —
  // так кэши и браузерная история не «приклеивают» код к первой странице.
  return NextResponse.redirect(target.toString(), 307)
}
