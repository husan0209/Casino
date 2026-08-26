import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto'

import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

const b64url = (buf: Buffer) => buf.toString('base64url')

function expiresToSeconds(v: string | undefined, fallback: number): number {
  if (!v) return fallback
  const m = /^(\d+)([smhd])$/.exec(v.trim())
  if (!m?.[1] || !m[2]) return fallback
  const mult = { s: 1, m: 60, h: 3600, d: 86400 }[m[2] as 's' | 'm' | 'h' | 'd']!
  return parseInt(m[1], 10) * mult
}

interface AccessPayload { sub: string; role: string; session_id: string; aud: string; iat: number; exp: number; iss: string }

/**
 * HS256 JWT по STACK.md ("JWT: HS256 MVP").
 * Реализация на node:crypto — без внешних зависимостей.
 */
@Injectable()
export class JwtTokenService {
  constructor(private config: ConfigService) {}

  private accessSecret(): string {
    const secret = this.config.get<string>('JWT_ACCESS_SECRET')
    if (!secret || secret.length < 32) throw new Error('JWT_ACCESS_SECRET_MISSING_OR_WEAK')
    return secret
  }

  signAccess(userId: string, role: string, sessionId: string): string {
    const now = Math.floor(Date.now() / 1000)
    const exp = now + expiresToSeconds(this.config.get<string>('JWT_ACCESS_EXPIRES_IN'), 15 * 60)
    const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
    const payload: AccessPayload = { sub: userId, role, session_id: sessionId, aud: 'user', iat: now, exp, iss: 'casino-platform' }
    const body = b64url(Buffer.from(JSON.stringify(payload)))
    const sig = createHmac('sha256', this.accessSecret()).update(`${header}.${body}`).digest('base64url')
    return `${header}.${body}.${sig}`
  }

  verifyAccess(token: string): { sub: string; role: string; session_id: string } {
    const [header, body, sig] = token.split('.') as [string, string, string]
    const expected = createHmac('sha256', this.accessSecret()).update(`${header}.${body}`).digest()
    const given = Buffer.from(sig!, 'base64url')
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new Error('BAD_SIGNATURE')
    const payload = JSON.parse(Buffer.from(body!, 'base64url').toString()) as AccessPayload
    if (payload.aud !== 'user') throw new Error('BAD_AUDIENCE')
    if (payload.exp * 1000 < Date.now()) throw new Error('TOKEN_EXPIRED')
    return { sub: payload.sub, role: payload.role, session_id: payload.session_id }
  }

  /** Refresh token: случайные 512 бит; в БД хранится только SHA-256 хеш. */
  generateRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(64).toString('hex')
    return { token, hash: this.hashRefreshToken(token) }
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }
}
