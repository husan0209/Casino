import type { Response } from 'express'

/** Имя куки, в котором живёт OAuth `state`. */
export const OAUTH_STATE_COOKIE = 'oauth_state'

/**
 * Окно `state`. Одна величина для подписи в `GoogleOAuthUseCase.verifyState` и
 * для `maxAge` куки: если они разъедутся, «живой» state будет отвергнут кукой
 * (или наоборот — просроченный state примётся кукой), и отказ придёт в момент,
 * когда пользователь уже прошёл Google.
 */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000

/** Область — тот же префикс, что у refresh-куки: только эндпоинты auth. */
const OAUTH_COOKIE_PATH = '/api/v1/auth'

/**
 * `state` должен приходить туда, откуда стартовал вход, то есть в cookie
 * браузера, а не только в теле запроса.
 *
 * Подпись на `state` (HMAC + таймстемп) доказывает лишь то, что его выдал наш
 * сервер. Он не доказывает, кто его принёс: `GET /auth/google/url` анонимный,
 * значит любой может получить валидный `state`, обменять свой код на свою
 * сессию и подсунуть пару `(code, state)` жертве. Жертва оказывается
 * залогиненной в аккаунт атакующего — в казино это «пополни счёт чужому
 * игроку» и угон атрибуции. Привязка к куки замыкает цепочку: инициатор входа
 * и тот, кто завершает, обязаны быть одним браузером.
 *
 * Флаги совпадают с refresh-кукой (`refresh-token-cookie.ts`): httpOnly,
 * sameSite=strict, secure в проде. `maxAge` чуть больше TTL подписи, чтобы
 * гонка «подпись ещё жива — кука истекла» не съедала легитимный вход.
 */
export function setOAuthStateCookie(res: Response, state: string): void {
  const isProduction = process.env['NODE_ENV'] === 'production'
  res.cookie(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    maxAge: OAUTH_STATE_TTL_MS + 60_000,
    path: OAUTH_COOKIE_PATH,
  })
}

/** state одноразовый: после успешного обмена кода кука снимается. */
export function clearOAuthStateCookie(res: Response): void {
  res.clearCookie(OAUTH_STATE_COOKIE, { path: OAUTH_COOKIE_PATH })
}
