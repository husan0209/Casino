import { createHmac } from 'crypto'

import { type ConfigService } from '@nestjs/config'
import * as argon2 from 'argon2'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { prisma } from '@casino/database'

import { AdminJwtTokenError } from '../src/modules/admin/domain/errors'
import { AdminAuthService } from '../src/modules/admin/infrastructure/admin-jwt.service'

// Prisma в этой среде недоступен, argon2 — дорогой (64 MiB на хеш): и то, и другое
// подменяется на уровне модуля, проверяется контракт, а не криптобиблиотека.
vi.mock('@casino/database', () => ({
  prisma: { adminUser: { findUnique: vi.fn() } },
}))

vi.mock('argon2', () => ({
  argon2id: 2,
  hash: vi.fn(async () => 'argon2-hash'),
  verify: vi.fn(async () => true),
}))

/**
 * UC-ADMIN-AUTH — подпись и проверка админского токена.
 *
 * Ключевой контракт: подпись игроцких и админских токенов — ОДИН секрет
 * (`JWT_ACCESS_SECRET`; отдельного `ADMIN_JWT_SECRET` в env-схеме нет), поэтому
 * токен игрока криптографически проходит проверку. Единственное, что не даёт
 * игроку сесть в админку, — проверка аудитории. Раньше она жила только в
 `AdminAuthGuard`, а сервис (`verify`) смотрел лишь подпись и срок; класс
 * экспортируется наружу модуля (`admin.module.ts:84`), и один новый потребитель
 * `verify()` без свёрки аудита открыл бы кабинет произвольному владельцу
 * игрового аккаунта. Теперь аудит и издатель проверяются на месте подписи.
 */
const SECRET = 'a'.repeat(64)
const OTHER_SECRET = 'b'.repeat(64)

function b64url(buf: Buffer): string {
  return buf.toString('base64url')
}

function makeToken(secret: string, payload: Record<string, unknown>): string {
  const h = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const p = b64url(Buffer.from(JSON.stringify(payload)))
  const sig = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')
  return `${h}.${p}.${sig}`
}

function service(secret = SECRET): AdminAuthService {
  const config = { get: () => secret } as unknown as ConfigService
  return new AdminAuthService(config)
}

function adminPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000)
  return {
    sub: 'adm-1',
    role: 'superadmin',
    aud: 'admin',
    iss: 'casino-platform',
    iat: now,
    exp: now + 8 * 3600,
    ...over,
  }
}

describe('AdminAuthService.sign', () => {
  it('выдаёт HS256-токен с аудиторией admin, издателем и сроком 8 часов', () => {
    const token = service().sign({ id: 'adm-7', role: 'admin' })
    const [, , sig] = token.split('.')
    expect(sig).toBeTruthy()

    const payload = service().verify(token)
    expect(payload).toMatchObject({
      sub: 'adm-7',
      role: 'admin',
      aud: 'admin',
      iss: 'casino-platform',
    })
    const now = Math.floor(Date.now() / 1000)
    expect((payload['exp'] as number) - (payload['iat'] as number)).toBe(8 * 3600)
    expect(payload['exp'] as number).toBeGreaterThan(now)
  })
})

describe('AdminAuthService.verify', () => {
  it('принимает токен, подписанный этим секретом', () => {
    const payload = service().verify(makeToken(SECRET, adminPayload()))
    expect(payload['sub']).toBe('adm-1')
  })

  it('токен, подписанный другим секретом → BAD_SIGNATURE', () => {
    const token = makeToken(OTHER_SECRET, adminPayload())
    expect(() => service().verify(token)).toThrow(AdminJwtTokenError)
    expect(() => service().verify(token)).toThrow(/BAD_SIGNATURE/)
  })

  it('подменённый payload (роль) → BAD_SIGNATURE', () => {
    const token = makeToken(SECRET, adminPayload())
    const [h, , sig] = token.split('.')
    const forged = b64url(
      Buffer.from(JSON.stringify({ ...adminPayload(), role: 'superadmin', sub: 'adm-9' })),
    )
    expect(() => service().verify(`${h}.${forged}.${sig}`)).toThrow(/BAD_SIGNATURE/)
  })

  it('просроченный токен → TOKEN_EXPIRED', () => {
    const token = makeToken(SECRET, adminPayload({ exp: Math.floor(Date.now() / 1000) - 1 }))
    expect(() => service().verify(token)).toThrow(/TOKEN_EXPIRED/)
  })

  it('токен игрока (aud="user"), подписанный ТЕМ ЖЕ секретом → BAD_AUDIENCE', () => {
    // Ровно тот кейс, который раньше останавливался только на guard'е:
    // подпись настоящая, срок настоящий, аудит — игровой.
    const playerToken = makeToken(SECRET, adminPayload({ aud: 'user' }))
    expect(() => service().verify(playerToken)).toThrow(/BAD_AUDIENCE/)
  })

  it('чужой издатель → BAD_ISSUER', () => {
    const token = makeToken(SECRET, adminPayload({ iss: 'someone-else' }))
    expect(() => service().verify(token)).toThrow(/BAD_ISSUER/)
  })

  it('битый токен → доменный MALFORMED_TOKEN, а не TypeError', () => {
    // `token.split('.')` из одной части давал Buffer.from(undefined) → TypeError,
    // и «не 500» держалось только на catch в guard'е.
    expect(() => service().verify('не-токен')).toThrow(AdminJwtTokenError)
    expect(() => service().verify('не-токен')).toThrow(/MALFORMED_TOKEN/)
    expect(() => service().verify('a.b.')).toThrow(/MALFORMED_TOKEN/)
  })
})

describe('AdminAuthService.validate', () => {
  const adminRow = {
    id: 'adm-1',
    email: 'root@example.com',
    passwordHash: 'argon2-hash',
    role: 'superadmin',
    isActive: true,
  }

  beforeEach(() => {
    // Мок argon2 живёт между тестами одного файла: без сброса проверка
    // «пароль не проверяем» ловила бы вызов из предыдущего кейса.
    vi.mocked(prisma.adminUser.findUnique).mockReset()
    vi.mocked(argon2.verify).mockReset().mockResolvedValue(true)
  })

  it('email нормализуется к нижнему регистру перед поиском', async () => {
    vi.mocked(prisma.adminUser.findUnique).mockResolvedValue(adminRow as never)

    const res = await service().validate('ROOT@Example.COM', 'secret')

    expect(prisma.adminUser.findUnique).toHaveBeenCalledWith({
      where: { email: 'root@example.com' },
    })
    expect(argon2.verify).toHaveBeenCalledWith('argon2-hash', 'secret')
    expect(res).toMatchObject({ id: 'adm-1' })
  })

  it('неактивный админ — пароль не проверяем, null', async () => {
    vi.mocked(prisma.adminUser.findUnique).mockResolvedValue({
      ...adminRow,
      isActive: false,
    } as never)

    const res = await service().validate('root@example.com', 'secret')

    expect(res).toBeNull()
    expect(argon2.verify).not.toHaveBeenCalled()
  })

  it('админа нет — null, и argon2 не дёргаем', async () => {
    vi.mocked(prisma.adminUser.findUnique).mockResolvedValue(null)

    expect(await service().validate('ghost@example.com', 'secret')).toBeNull()
    expect(argon2.verify).not.toHaveBeenCalled()
  })

  it('неверный пароль → null', async () => {
    vi.mocked(prisma.adminUser.findUnique).mockResolvedValue(adminRow as never)
    vi.mocked(argon2.verify).mockResolvedValueOnce(false)

    expect(await service().validate('root@example.com', 'wrong')).toBeNull()
  })
})
