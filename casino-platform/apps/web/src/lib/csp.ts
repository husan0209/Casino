/**
 * CSP публичного веб-хоста. Чистая функция (без `next/server`) — чтобы политику
 * можно было проверить юнит-спеком вне Edge-рантайма: apps/web/test/csp.spec.ts.
 * Образец — apps/admin/src/lib/csp.ts.
 *
 * ПРО РЕЖИМ РЕНДЕРИНГА (почему здесь нет nonce и 'strict-dynamic').
 * Канонический паттерн Next.js — генерировать nonce в middleware и подставлять
 * его в свои скрипты. Он требует динамического рендеринга: nonce живёт в
 * запросе, а статическая страница пререндерится на сборке и лежит на диске уже
 * без него. У нас все маршруты статические, поэтому nonce в HTML не появляется
 * НИ РАЗУ. Раньше здесь стоял `'strict-dynamic'`: по CSP L3 его присутствие
 * обязывает браузер игнорировать `'self'`, `https:` и `'unsafe-inline'`, и
 * единственным разрешённым источником скриптов остаётся nonce. В сборке main
 * nonce не было ни в одном из 514 тегов <script> — то есть не исполнялся ни
 * один скрипт на сайте: ни гидратация, ни касса, ни кабинет партнёра.
 * Ужесточение (nonce без 'unsafe-inline') требует `force-dynamic` на всех
 * маршрутах — это отдельная задача с замером TTFB, а не побочка.
 *
 * Telegram Mini App (GAP-21). В Telegram для iOS/Android приложение открывается
 * как обычный документ в WebView — ограничения на фрейм его не касаются. В
 * Telegram Web (K/A) и в десктопе Mini App рендерится ВНУТРИ iframe на
 * `*.telegram.org`, и с `frame-ancestors 'self'` наш же сайт отказывался
 * отрисовываться внутри Telegram. Добавляем ровно телеграм-хосты: разрешить
 * `https:` целиком — это снова «встраивайся кто угодно», а clickjacking на
 * кассе платёжного сайта стоит денег.
 */

export interface WebCspInput {
  /** Базовый URL API из lib/api-base (NEXT_PUBLIC_API_URL). */
  apiBaseUrl: string
  /** Origin ответа, которому middleware ставит заголовок (request.nextUrl.origin). */
  requestOrigin: string
  isDev: boolean
}

/** Откуда Mini App может быть встроен, кроме нас самих. */
export const TELEGRAM_FRAME_ANCESTORS: readonly string[] = [
  'https://telegram.org',
  'https://*.telegram.org',
  'https://web.telegram.org',
]

/** Origin строки или '' если URL нераспознан (не роняем запрос из-за CSP). */
function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

/**
 * В dev API кросс-доменный (дефолт API_BASE_URL = http://localhost:3001/api/v1 —
 * тот же, на который ходит клиент), и `connect-src 'self' https:` резал
 * браузерные запросы к нему до прихода на API («Network Error»). В проде API
 * same-origin за nginx — 'self' покрывает, поэтому origin API добавляется
 * только когда он реально другой.
 */
export function buildConnectSrc({ apiBaseUrl, requestOrigin }: WebCspInput): string {
  const apiOrigin = originOf(apiBaseUrl)
  return apiOrigin && apiOrigin !== requestOrigin ? `'self' ${apiOrigin} https:` : `'self' https:`
}

export function buildFrameAncestors(): string {
  // Кавычка ТОЛЬКО вокруг ключевого слова: `frame-ancestors 'self https://…'`
  // браузер прочитал бы как один источник и непустил бы ни одного.
  return [`'self'`, ...TELEGRAM_FRAME_ANCESTORS].join(' ')
}

export function buildWebCsp(input: WebCspInput): string {
  const { isDev } = input

  return [
    `default-src 'self'`,
    // 'self' — внешние скрипты (Next отдаёт их сам), 'unsafe-inline' — бутстрап.
    // 'strict-dynamic' здесь недопустим: он отключил бы и 'self', и 'unsafe-inline'
    // (см. докблок выше), а подставить nonce в статику нечем.
    // https: нужен и скрипту Mini App (telegram.org/js/telegram-web-app.js),
    // который мы вставляем только внутри Telegram — см. lib/telegram-webapp.ts.
    `script-src 'self' 'unsafe-inline' https:${isDev ? " 'unsafe-eval'" : ''}`,
    // Next styled-jsx/глобальные стили: инлайновые <style> без nonce
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data: https:`,
    `font-src 'self'`,
    `connect-src ${buildConnectSrc(input)}`,
    // iframe игр и виджетов (Telegram/Google)
    `frame-src 'self' https:`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    // 'self' + хосты Telegram: иначе Mini App не отрисовывается в веб-клиенте
    `frame-ancestors ${buildFrameAncestors()}`,
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ')
}
