/**
 * JWT-сервис партнёров (ТЗ ч.8 §16).
 *
 * ОТДЕЛЬНАЯ АУДИТОРИЯ И СЕКРЕТ. Партнёрский токен имеет `aud: 'affiliate'` и
 * подписан `AFFILIATE_JWT_SECRET`. Это не перестраховка, а требование:
 *
 *  - player-токен (`aud: 'user'`) не должен открывать партнёрский кабинет;
 *  - admin-токен (`aud: 'admin'') не должен открывать партнёрский кабинет;
 *  - компрометация партнёрского контура не даёт доступа к игроку.
 *
 * Проверка aud обязательна в verify: иначе токен одного контура примет другой.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { type AffiliateTokenPayload, type IAffiliateJwtService } from '../domain/affiliate.ports'
import {
  AffiliateCredentialsInvalidError,
  AffiliateJwtSecretInvalidError,
} from '../domain/errors/affiliate.errors'

/** Минимальная длина секрета — как у остальных JWT-секретов проекта. */
const MIN_SECRET_LENGTH = 64

/** Fallback для dev/test. В production env-валидация требует настоящий секрет. */
const DEV_SECRET = 'affiliate-dev-secret-must-be-overridden-in-production-0123456789abcdef'

function b64url(buffer: Buffer): string {
  return buffer.toString('base64url')
}

/** "15m" / "30d" / "1h" → секунды. Неизвестный формат → дефолт. */
function expiresToSeconds(value: string | undefined, fallbackSeconds: number): number {
  if (value === undefined || value === '') {
    return fallbackSeconds
  }
  const match = /^(\d+)([smhd])$/.exec(value.trim())
  if (match?.[1] === undefined || match[2] === undefined) {
    return fallbackSeconds
  }
  // Record, а не литеральный объект: иначе TS считает lookup всегда успешным
  // и guard ниже выглядит мёртвым кодом. Здесь значение правда может отсутствовать.
  const multipliers: Record<string, number | undefined> = { s: 1, m: 60, h: 3600, d: 86400 }
  const multiplier = multipliers[match[2] as string]
  if (multiplier === undefined) {
    return fallbackSeconds
  }
  return parseInt(match[1], 10) * multiplier
}

@Injectable()
export class AffiliateJwtService implements IAffiliateJwtService {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  private secret(): string {
    const value = this.config.get<string>('AFFILIATE_JWT_SECRET') ?? ''
    if (value.length >= MIN_SECRET_LENGTH) {
      return value
    }
    if (this.config.get<string>('NODE_ENV') === 'production') {
      // В production слабый/отсутствующий секрет — фатальная ошибка, а не
      // молчаливое использование dev-значения.
      throw new AffiliateJwtSecretInvalidError(value.length)
    }
    return DEV_SECRET
  }

  /** Access-токен партнёра. `sub` = affiliateId. */
  signAccess(affiliateId: string, email: string): string {
    const now = Math.floor(Date.now() / 1000)
    const ttl = expiresToSeconds(this.config.get<string>('AFFILIATE_JWT_ACCESS_EXPIRES_IN'), 3600)
    const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
    const payload: AffiliateTokenPayload = {
      sub: affiliateId,
      email,
      aud: 'affiliate',
      iat: now,
      exp: now + ttl,
      iss: 'casino-platform',
    }
    const body = b64url(Buffer.from(JSON.stringify(payload)))
    const signature = createHmac('sha256', this.secret())
      .update(`${header}.${body}`)
      .digest('base64url')
    return `${header}.${body}.${signature}`
  }

  /**
   * Верификация access-токена.
   *
   * @throws {AffiliateCredentialsInvalidError} на любой дефект: неверная
   * подпись, чужой aud, истёкший срок. Наружу не отдаём причину — иначе
   * атакующий понимает, что именно не так (алгоритм, aud, срок).
   */
  verifyAccess(token: string): AffiliateTokenPayload {
    const parts = token.split('.')
    if (parts.length !== 3) {
      throw new AffiliateCredentialsInvalidError()
    }
    const [header, body, signature] = parts as [string, string, string]
    this.assertHeader(header)
    this.assertSignature(`${header}.${body}`, signature)
    const payload = this.parsePayload(body)
    if (payload.iss !== 'casino-platform' || payload.aud !== 'affiliate') {
      throw new AffiliateCredentialsInvalidError()
    }
    if (payload.exp * 1000 < Date.now()) {
      throw new AffiliateCredentialsInvalidError()
    }
    return payload
  }

  /**
   * Refresh-токен: 512 бит случайности. В БД хранится ТОЛЬКО SHA-256 хеш,
   * поэтому утечка БД не даёт возможности войти под партнёром.
   */
  generateRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(64).toString('hex')
    return { token, hash: this.hashRefreshToken(token) }
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }

  private assertHeader(header: string): void {
    const decoded = JSON.parse(Buffer.from(header, 'base64url').toString()) as { alg?: string }
    if (decoded.alg !== 'HS256') {
      throw new AffiliateCredentialsInvalidError()
    }
  }

  private assertSignature(signingInput: string, signature: string): void {
    const expected = createHmac('sha256', this.secret()).update(signingInput).digest()
    const given = Buffer.from(signature, 'base64url')
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new AffiliateCredentialsInvalidError()
    }
  }

  private parsePayload(body: string): AffiliateTokenPayload {
    try {
      return JSON.parse(Buffer.from(body, 'base64url').toString()) as AffiliateTokenPayload
    } catch {
      throw new AffiliateCredentialsInvalidError()
    }
  }
}
