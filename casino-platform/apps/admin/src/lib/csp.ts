/**
 * CSP админки. Чистая функция (без `next/server`) специально для того, чтобы
 * политику реально можно было проверить юнит-спеком вне Edge-рантайма —
 * apps/admin/test/csp.spec.ts. См. также apps/admin/src/middleware.ts.
 *
 * ПРО РЕЖИМ РЕНДЕРИНГА (почему здесь нет nonce и 'strict-dynamic').
 * Админка собирается в `output: 'standalone'`, но маршруты пререндерятся на
 * СБОРКЕ: HTML лежит на диске уже готовым. Нонс живёт в запросе, поэтому в
 * собранном HTML его нет ни в одном <script> — а Next добавляет в каждый
 * пререндеренный документ инлайновый бутстрап (`self.__next_f.push(...)`),
 * который без 'unsafe-inline' не исполнится. По CSP L3 присутствие
 * 'strict-dynamic' ОБЯЗЫВАЕТ браузер игнорировать 'self' и https:, то есть
 * источником скрипта остаётся только нонс. Итог — ровно дефект d201c1e:
 * ни один скрипт не исполняется, при этом все гейты зелёные.
 *
 * Поэтому рабочая политика для статической сборки: 'self' (внешние скрипты
 * отдаёт сам Next) + 'unsafe-inline' (инлайновый бутстрап). Нонс включим вместе
 * с динамическим рендерингом маршрутов — отдельная задача, не побочка.
 *
 * connect-src обязан включать origin API: vhost ADMIN_DOMAIN не проксирует
 * /api/ (GAP-59), axios ходит на абсолютный URL ДРУГОГО origin — политика без
 * него убила бы каждый запрос админки.
 */

export interface CspInput {
  /** Базовый URL API из lib/api-base (NEXT_PUBLIC_API_URL). */
  apiBaseUrl: string
  /** Origin ответа, которому middleware ставит заголовок (request.nextUrl.origin). */
  requestOrigin: string
  isDev: boolean
}

/** Origin строки или '' если URL нераспознан (не роняем запрос из-за CSP). */
function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

export function buildConnectSrc({ apiBaseUrl, requestOrigin }: CspInput): string {
  const apiOrigin = originOf(apiBaseUrl)
  // 'self' покрывает same-origin API; чужой origin добавляется только когда он
  // реально другой (иначе дубль в заголовке).
  return apiOrigin && apiOrigin !== requestOrigin ? `'self' ${apiOrigin} https:` : `'self' https:`
}

/**
 * Админка — back-office: без внешних скриптов, без iframe'ов, без сторонних
 * шрифтов (проверено по apps/admin/src — ни next/script, ни <iframe>, ни url()
 * в globals.css), поэтому директивы строже публичного веб-хоста.
 */
export function buildAdminCsp(input: CspInput): string {
  const { isDev } = input

  return [
    `default-src 'self'`,
    // 'unsafe-inline' — инлайновый бутстрап Next в пререндеренном HTML; без него
    // админка мертва (см. докблок). 'strict-dynamic' тут недопустим по определению.
    `script-src 'self' 'unsafe-inline'${isDev ? ` 'unsafe-eval'` : ''}`,
    // Tailwind + styled-jsx кладут <style> инлайном, нонса в статике нет.
    `style-src 'self' 'unsafe-inline'`,
    // Аватары/миниатюры приходят с абсолютных https-URL (uploads за nginx).
    `img-src 'self' blob: data: https:`,
    `font-src 'self'`,
    `connect-src ${buildConnectSrc(input)}`,
    // Внутренних фреймов у админки нет; внешний контент в iframe — только риск
    // clickjacking в сторону админских сессий.
    `frame-src 'none'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    // Формы админки (логин) отправляются на свой origin через axios/onSubmit.
    `form-action 'self'`,
    // Админку нельзя встраивать вообще — строже, чем SAMEORIGIN у веб-хоста,
    // и согласовано с X-Frame-Options: DENY на nginx.
    `frame-ancestors 'none'`,
    ...(isDev ? [] : [`upgrade-insecure-requests`]),
  ].join('; ')
}
