import { createHmac, timingSafeEqual } from 'crypto'

import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as argon2 from 'argon2'

import { type AdminRole, prisma } from '@casino/database'

import { AdminJwtTokenError } from '../domain/errors'

const b64url = (buf: Buffer): string => buf.toString('base64url')

/** HS256 JWT на node:crypto — jsonwebtoken недоступен как зависимость (см. IMPLEMENTATION_GAPS GAP-01). */
function hs256(secret: string, header: object, payload: object): string {
  const h = b64url(Buffer.from(JSON.stringify(header)))
  const p = b64url(Buffer.from(JSON.stringify(payload)))
  const sig = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')
  return `${h}.${p}.${sig}`
}

function hs256Verify(secret: string, token: string): Record<string, unknown> {
  const parts = token.split('.')
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new AdminJwtTokenError('MALFORMED_TOKEN')
  }
  const [h, p, sig] = parts as [string, string, string]
  const expected = createHmac('sha256', secret).update(`${h}.${p}`).digest()
  const given = Buffer.from(sig, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new AdminJwtTokenError('BAD_SIGNATURE')
  }
  try {
    return JSON.parse(Buffer.from(p, 'base64url').toString()) as Record<string, unknown>
  } catch {
    // Подпись совпала, а payload не читается как JSON. Без этого ветки сырой
    // SyntaxError уходил наружу: guard конвертирует не-AppError в 401, но сервис
    // экспортируется из модуля (admin.module.ts:84), и следующий потребитель
    // получил бы 500.
    throw new AdminJwtTokenError('MALFORMED_TOKEN')
  }
}

@Injectable()
export class AdminAuthService {
  constructor(@Inject(ConfigService) private config: ConfigService) {}
  async validate(
    email: string,
    password: string,
  ): Promise<{
    id: string
    email: string
    passwordHash: string
    role: AdminRole
    firstName: string | null
    lastName: string | null
    isActive: boolean
    createdBy: string | null
    lastLoginAt: Date | null
    createdAt: Date
    updatedAt: Date
  } | null> {
    const admin = await prisma.adminUser.findUnique({ where: { email: email.toLowerCase() } })
    if (!admin?.isActive) {
      return null
    }
    const ok = await argon2.verify(admin.passwordHash, password)
    if (!ok) {
      return null
    }
    return admin
  }
  sign(admin: { id: string; role: string }): string {
    const now = Math.floor(Date.now() / 1000)
    const token = hs256(
      this.config.get<string>('JWT_ACCESS_SECRET')!,
      { alg: 'HS256', typ: 'JWT' },
      {
        sub: admin.id,
        role: admin.role,
        aud: 'admin',
        iss: 'casino-platform',
        iat: now,
        exp: now + 8 * 3600,
      },
    )
    return token
  }
  /**
   * Проверка админского токена.
   *
   * Класс `AdminAuthGuard` сверяет `aud === 'admin'` сам, но это не повод
   * игнорировать аудит здесь: подпись игроцких и админских токенов — ОДИН
   * секрет (`JWT_ACCESS_SECRET`, отдельного `ADMIN_JWT_SECRET` в env-схеме нет),
   * поэтому токен игрока криптографически валиден. Вся защита контура держится на
   * одной проверке в одном месте — достаточно нового потребителя `verify()`
   * (сервис экспортируется наружу модуля, `admin.module.ts:84), чтобы аудит
   * перестали смотреть. Проверяем и здесь: отказ дешевле допущения.
   *
   * `iss` — по той же причине: ключ `casino-platform` отличает наши токены от
   * любого HMAC, подписанного тем же секретом вне контура.
   */
  verify(token: string): Record<string, unknown> {
    const payload = hs256Verify(this.config.get<string>('JWT_ACCESS_SECRET')!, token)
    const exp = typeof payload['exp'] === 'number' ? payload['exp'] : 0
    if (exp * 1000 < Date.now()) {
      throw new AdminJwtTokenError('TOKEN_EXPIRED')
    }
    if (payload['aud'] !== 'admin') {
      throw new AdminJwtTokenError('BAD_AUDIENCE')
    }
    if (payload['iss'] !== 'casino-platform') {
      throw new AdminJwtTokenError('BAD_ISSUER')
    }
    return payload
  }
}
