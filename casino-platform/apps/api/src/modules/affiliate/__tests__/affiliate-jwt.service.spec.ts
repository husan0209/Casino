import { createHmac } from 'node:crypto'

import { beforeEach, describe, expect, it } from 'vitest'

import { AffiliateCredentialsInvalidError } from '../domain/errors/affiliate.errors'
import { AffiliateJwtService } from '../infrastructure/affiliate-jwt.service'

/** Заглушка ConfigService: нужны только get() по строковым ключам. */
function makeConfig(values: Record<string, string | undefined>): { get: (key: string) => unknown } {
  return {
    get: (key: string): unknown => values[key],
  }
}

const SECRET = 'a'.repeat(64)

/** Подписанный вручную токен с произвольным aud — для проверки изоляции контуров. */
function signWith(secret: string, payload: Record<string, unknown>): string {
  const b64 = (value: Buffer | string): string =>
    (Buffer.isBuffer(value) ? value : Buffer.from(value)).toString('base64url')
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64(JSON.stringify(payload))
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${signature}`
}

describe('AffiliateJwtService', () => {
  let service: AffiliateJwtService

  beforeEach(() => {
    service = new AffiliateJwtService(
      makeConfig({ AFFILIATE_JWT_SECRET: SECRET, NODE_ENV: 'test' }) as never,
    )
  })

  it('signs a token with affiliate audience', () => {
    const token = service.signAccess('aff-1', 'partner@example.com')
    const payload = service.verifyAccess(token)

    expect(payload.sub).toBe('aff-1')
    expect(payload.email).toBe('partner@example.com')
    expect(payload.aud).toBe('affiliate')
  })

  it('round-trips affiliate id and email', () => {
    const token = service.signAccess('aff-42', 'a@b.ru')
    expect(service.verifyAccess(token)).toMatchObject({ sub: 'aff-42', email: 'a@b.ru' })
  })

  it('rejects a player token (aud=user) — контуры разделены', () => {
    const now = Math.floor(Date.now() / 1000)
    const playerToken = signWith(SECRET, {
      sub: 'player-1',
      role: 'user',
      aud: 'user',
      iss: 'casino-platform',
      iat: now,
      exp: now + 3600,
    })

    expect(() => service.verifyAccess(playerToken)).toThrow(AffiliateCredentialsInvalidError)
  })

  it('rejects an admin token (aud=admin)', () => {
    const now = Math.floor(Date.now() / 1000)
    const adminToken = signWith(SECRET, {
      sub: 'admin-1',
      role: 'superadmin',
      aud: 'admin',
      iss: 'casino-platform',
      iat: now,
      exp: now + 3600,
    })

    expect(() => service.verifyAccess(adminToken)).toThrow(AffiliateCredentialsInvalidError)
  })

  it('rejects a token signed with a different secret', () => {
    const now = Math.floor(Date.now() / 1000)
    const foreign = signWith('b'.repeat(64), {
      sub: 'aff-1',
      email: 'x@y.ru',
      aud: 'affiliate',
      iss: 'casino-platform',
      iat: now,
      exp: now + 3600,
    })

    expect(() => service.verifyAccess(foreign)).toThrow(AffiliateCredentialsInvalidError)
  })

  it('rejects an expired token', () => {
    const now = Math.floor(Date.now() / 1000)
    const expired = signWith(SECRET, {
      sub: 'aff-1',
      email: 'x@y.ru',
      aud: 'affiliate',
      iss: 'casino-platform',
      iat: now - 7200,
      exp: now - 3600,
    })

    expect(() => service.verifyAccess(expired)).toThrow(AffiliateCredentialsInvalidError)
  })

  it('rejects the "none" algorithm downgrade', () => {
    const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
      'base64url',
    )
    const body = Buffer.from(
      JSON.stringify({
        sub: 'aff-1',
        email: 'x@y.ru',
        aud: 'affiliate',
        iss: 'casino-platform',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString('base64url')

    expect(() => service.verifyAccess(`${noneHeader}.${body}.`)).toThrow(
      AffiliateCredentialsInvalidError,
    )
  })

  it('rejects a malformed token without leaking the reason', () => {
    expect(() => service.verifyAccess('not-a-token')).toThrow(AffiliateCredentialsInvalidError)
    expect(() => service.verifyAccess('a.b')).toThrow(AffiliateCredentialsInvalidError)
  })

  it('stores only a hash of the refresh token', () => {
    const { token, hash } = service.generateRefreshToken()

    expect(token).toHaveLength(128)
    expect(hash).not.toBe(token)
    expect(service.hashRefreshToken(token)).toBe(hash)
  })

  it('generates a different refresh token each time', () => {
    expect(service.generateRefreshToken().token).not.toBe(service.generateRefreshToken().token)
  })

  it('throws in production when the secret is missing or weak', () => {
    const weak = new AffiliateJwtService(
      makeConfig({ AFFILIATE_JWT_SECRET: 'short', NODE_ENV: 'production' }) as never,
    )
    // Проверяем стабильный code, а не текст сообщения: code попадает в
    // контракт API, а сообщение — человекочитаемый текст и может меняться.
    expect(() => weak.signAccess('aff-1', 'a@b.ru')).toThrow(
      expect.objectContaining({ code: 'AFFILIATE_JWT_SECRET_MISSING_OR_WEAK' }),
    )
  })

  it('falls back to a dev secret outside production', () => {
    const dev = new AffiliateJwtService(makeConfig({ NODE_ENV: 'development' }) as never)
    expect(() => dev.signAccess('aff-1', 'a@b.ru')).not.toThrow()
  })
})
