import type { Response } from 'express'

/** Имя куки, в котором живёт nonce Google One Tap. */
export const GOOGLE_NONCE_COOKIE = 'g_one_tap'

/**
 * Окно nonce. Одна величина для подписи в `GoogleOneTapUseCase` и для `maxAge`
 * куки: разъедутся — и живой nonce отвергнется кукой (или просроченный примётся),
 * а отказ придёт, когда игрок уже тапнул «Продолжить как …» в диалоге Google.
 */
export const GOOGLE_NONCE_TTL_MS = 10 * 60 * 1000

/** Тот же префикс, что у `state` и refresh-куки: только эндпоинты auth. */
const NONCE_COOKIE_PATH = '/api/v1/auth'

/**
 * Nonce обязан лежать в httpOnly-куке браузера, который начал вход, а не в теле
 * запроса.
 *
 * ID-токен — предъявительский артефакт: кто его принес, тот и вошёл. Если бы
 * ожидаемый nonce приходил в теле, атакующий сам выбрал бы его, подсунул
 * украденный у жертвы токен (Google кладёт nonce в токен, а не в запрос) и
 * получил сессию жертвы. Кука замыкает цепочку «этот токен выдан для этого
 * браузера»: значение подписывает сервер, прочитать и подменить его со стороны
 * страницы нельзя.
 *
 * Флаги — как у `oauth_state`: httpOnly, sameSite=strict, secure в проде.
 * `maxAge` на минуту больше TTL подписи: переживает её кука не может (она дольше),
 * а вот подпись внутри может устареть раньше — тогда тап позже 10 минут даст
 * `OAUTH_STATE_INVALID`, и клиент попросит новый nonce.
 */
export function setGoogleNonceCookie(res: Response, nonce: string): void {
  const isProduction = process.env['NODE_ENV'] === 'production'
  res.cookie(GOOGLE_NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    maxAge: GOOGLE_NONCE_TTL_MS + 60_000,
    path: NONCE_COOKIE_PATH,
  })
}

/**
 * После обмена кука снимается: второй тап тем же токеном её уже не найдёт. Строгой
 * одноразовости на сервере нет — список выданных nonce не ведём (остаток принят тем
 * же решением, что в Mini App), поэтому в окне TTL повтор из этого же браузера
 * возможен.
 */
export function clearGoogleNonceCookie(res: Response): void {
  res.clearCookie(GOOGLE_NONCE_COOKIE, { path: NONCE_COOKIE_PATH })
}
