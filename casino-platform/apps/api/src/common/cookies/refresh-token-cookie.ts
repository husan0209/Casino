import { expiresToSeconds } from '@casino/shared-utils'

import type { Response } from 'express'

/** Резерв совпадает с `JwtTokenService.refreshLifetime()` — окно выхода одно. */
const DEFAULT_REFRESH_LIFETIME_SECONDS = 30 * 86400

/**
 * Sets the refresh-token cookie with security attributes.
 *
 * Security flags:
 * - httpOnly: prevents JS access (XSS protection)
 * - secure: true in production, false in development (allow http://localhost)
 * - sameSite: 'strict' prevents CSRF on cross-site requests
 *
 * If you change the cookie name or flags, update ALL call sites.
 * Don't inline cookie config in controllers — use this helper.
 *
 * `maxAge` читается из того же `JWT_REFRESH_EXPIRES_IN`, что и `expiresAt`
 * сессии (`JwtTokenService.refreshLifetime()`), через общий `expiresToSeconds`:
 * прежний хардкод 30 суток означал, что при окне в 7 дней кука пережила бы
 * отозванную сессию и клиент слал бы заведомо невалидный refresh до конца месяца.
 */
export function setRefreshTokenCookie(res: Response, refreshToken: string): void {
  const isProduction = process.env['NODE_ENV'] === 'production'
  const maxAgeMs =
    expiresToSeconds(process.env['JWT_REFRESH_EXPIRES_IN'], DEFAULT_REFRESH_LIFETIME_SECONDS) * 1000
  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    maxAge: maxAgeMs,
    path: '/api/v1/auth', // limit scope to auth endpoints
  })
}

export function clearRefreshTokenCookie(res: Response): void {
  res.clearCookie('refresh_token', { path: '/api/v1/auth' })
}
