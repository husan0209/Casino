import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto'

import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { expiresToSeconds } from '@casino/shared-utils'

import { type IJwtTokenService } from '../../domain/auth.ports'
import { JwtSecretWeakError, JwtTokenError } from '../../domain/errors'

const b64url = (buf: Buffer): string => buf.toString('base64url')

/** Резерв, если `JWT_REFRESH_EXPIRES_IN` отсутствует или разобрался криво. */
const DEFAULT_REFRESH_LIFETIME_SECONDS = 30 * 86400

interface AccessPayload {
  sub: string
  role: string
  session_id: string
  aud: string
  iat: number
  exp: number
  iss: string
}

/**
 * HS256 JWT по STACK.md ("JWT: HS256 MVP").
 * Реализация на node:crypto — без внешних зависимостей.
 */
@Injectable()
export class JwtTokenService implements IJwtTokenService {
  constructor(@Inject(ConfigService) private config: ConfigService) {}

  private accessSecret(): string {
    const secret = this.config.get<string>('JWT_ACCESS_SECRET')
    if (!secret || secret.length < 32) {
      throw new JwtSecretWeakError()
    }
    return secret
  }

  signAccess(userId: string, role: string, sessionId: string): string {
    const now = Math.floor(Date.now() / 1000)
    const exp = now + expiresToSeconds(this.config.get<string>('JWT_ACCESS_EXPIRES_IN'), 15 * 60)
    const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
    const payload: AccessPayload = {
      sub: userId,
      role,
      session_id: sessionId,
      aud: 'user',
      iat: now,
      exp,
      iss: 'casino-platform',
    }
    const body = b64url(Buffer.from(JSON.stringify(payload)))
    const sig = createHmac('sha256', this.accessSecret())
      .update(`${header}.${body}`)
      .digest('base64url')
    return `${header}.${body}.${sig}`
  }

  verifyAccess(token: string): { sub: string; role: string; session_id: string } {
    const parts = token.split('.')
    if (parts.length !== 3) {
      throw new JwtTokenError('BAD_TOKEN')
    }
    const [header, body, sig] = parts as [string, string, string]
    const headerRaw = JSON.parse(Buffer.from(header, 'base64url').toString()) as { alg?: string }
    if (headerRaw.alg !== 'HS256') {
      throw new JwtTokenError('BAD_ALGORITHM')
    }
    const expected = createHmac('sha256', this.accessSecret()).update(`${header}.${body}`).digest()
    const given = Buffer.from(sig, 'base64url')
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new JwtTokenError('BAD_SIGNATURE')
    }
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as AccessPayload
    if (payload.iss !== 'casino-platform') {
      throw new JwtTokenError('BAD_ISSUER')
    }
    if (payload.aud !== 'user') {
      throw new JwtTokenError('BAD_AUDIENCE')
    }
    if (payload.exp * 1000 < Date.now()) {
      throw new JwtTokenError('TOKEN_EXPIRED')
    }
    return { sub: payload.sub, role: payload.role, session_id: payload.session_id }
  }

  /** Refresh token: случайные 512 бит; в БД хранится только SHA-256 хеш. */
  generateRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(64).toString('hex')
    return { token, hash: this.hashRefreshToken(token) }
  }

  /**
   * Срок жизни refresh-сессии — `JWT_REFRESH_EXPIRES_IN` (резерв: 30 суток).
   *
   * До этого пять мест (`login`, `refresh`, `register`, `verify-email`,
   * OAuth-провижинение) считали `30 * 24 * 3600 * 1000` каждое у себя, а переменная
   * `JWT_REFRESH_EXPIRES_IN` была описана в env-схеме
   * (`packages/shared-config/src/env.validation.ts:90`) и не читалась НИКТО: окно
   * выхода из конфигурации изменить было нельзя — контракт существовал только на
   * бумаге. Теперь источник один, и `maxAge` cookie (`common/cookies`) читает ту же
   * переменную, чтобы кука не переживала отозванную сессию.
   *
   * `maxAgeMs` возвращается вместе с `expiresAt`: это одно и то же число в двух
   * единицах, а два независимых разбора `30d` разъезжаются молча.
   */
  refreshLifetime(): { expiresAt: Date; maxAgeMs: number } {
    const seconds = expiresToSeconds(
      this.config.get<string>('JWT_REFRESH_EXPIRES_IN'),
      DEFAULT_REFRESH_LIFETIME_SECONDS,
    )
    const maxAgeMs = seconds * 1000
    return { expiresAt: new Date(Date.now() + maxAgeMs), maxAgeMs }
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }
}
