import type { Response } from 'express'

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
 */
export function setRefreshTokenCookie(res: Response, refreshToken: string): void {
  const isProduction = process.env['NODE_ENV'] === 'production'
  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    maxAge: 30 * 24 * 3600 * 1000,
    path: '/api/v1/auth', // limit scope to auth endpoints
  })
}

export function clearRefreshTokenCookie(res: Response): void {
  res.clearCookie('refresh_token', { path: '/api/v1/auth' })
}
