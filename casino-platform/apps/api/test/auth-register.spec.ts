/**
 * Юнит-тесты RegisterUseCase (G21).
 *
 * Порты — in-memory фейки с записью вызовов. Affiliate-контур подменяется
 * фейковым ModuleRef: атрибуция best-effort и не должна ломать регистрацию.
 */
import { RegisterUseCase } from '../src/modules/auth/application/use-cases/register.use-case'
import { User } from '../src/modules/auth/domain/entities/user.entity'
import {
  EmailAlreadyExistsError,
  ReferralCodeGenerationError,
  WeakPasswordError,
} from '../src/modules/auth/domain/errors'

import type {
  IEmailQueueService,
  IJwtTokenService,
  IPasswordHasher,
} from '../src/modules/auth/domain/auth.ports'
import type { UserProps } from '../src/modules/auth/domain/entities/user.entity'
import type {
  ISessionRepository,
  SessionCreateInput,
  SessionView,
} from '../src/modules/auth/domain/repositories/session.repository'
import type {
  CreateUserInput,
  IUserRepository,
} from '../src/modules/auth/domain/repositories/user.repository'
import type { IEmailVerificationRepository } from '../src/modules/auth/domain/repositories/verification-token.repository'
import type { ModuleRef } from '@nestjs/core'

function makeUser(over: Partial<UserProps> = {}): User {
  return new User({
    id: 'u-1',
    email: 'user@test.dev',
    username: null,
    passwordHash: null,
    status: 'active',
    role: 'user',
    emailVerified: false,
    referralCode: 'REFCODE1',
    referredBy: null,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    failedLoginAttempts: 0,
    lastFailedAt: null,
    lockedUntil: null,
    ...over,
  })
}

function makeUsersRepo(
  over: { existing?: User; referrer?: User; codeExists?: () => boolean } = {},
) {
  const created: CreateUserInput[] = []
  const repo: IUserRepository = {
    findByEmail: async () => over.existing ?? null,
    findById: async () => null,
    findByReferralCode: async () => over.referrer ?? null,
    referralCodeExists: async () => over.codeExists?.() ?? false,
    create: async (input) => {
      created.push(input)
      return makeUser({
        email: input.email,
        referralCode: input.referralCode,
        referredBy: input.referredBy ?? null,
      })
    },
    update: async () => {},
  }
  return { repo, created }
}

function makeSessionsRepo() {
  const createdInputs: SessionCreateInput[] = []
  const repo: ISessionRepository = {
    create: async (input) => {
      createdInputs.push(input)
      return { id: 'sess-1', ...input } as SessionView
    },
    findByRefreshTokenHash: async () => null,
    revoke: async () => {},
    revokeAllUserSessions: async () => {},
    revokeAllUserSessionsExcept: async () => {},
  }
  return { repo, createdInputs }
}

function makeVerifRepo() {
  const created: Array<{ userId: string; token: string; expiresAt: Date }> = []
  const repo: IEmailVerificationRepository = {
    create: async (userId, token, expiresAt) => {
      created.push({ userId, token, expiresAt })
      return { id: 'v-1', userId, token, expiresAt, usedAt: null }
    },
    findByToken: async () => null,
    markUsed: async () => {},
  }
  return { repo, created }
}

function makeHasher() {
  const hashed: string[] = []
  const hasher: IPasswordHasher = {
    hash: async (plain) => {
      hashed.push(plain)
      return `hash:${plain}`
    },
    verify: async () => true,
  }
  return { hasher, hashed }
}

function makeEmail() {
  const sent: Array<{ to: string; token: string }> = []
  const email: IEmailQueueService = {
    sendVerificationEmail: async (to, token) => {
      sent.push({ to, token })
      return 'queued'
    },
    sendPasswordReset: async () => 'queued',
  }
  return { email, sent }
}

function makeJwt() {
  const accessCalls: Array<{ userId: string; role: string; sessionId: string }> = []
  let refreshSeq = 0
  const jwt: IJwtTokenService = {
    signAccess: (userId, role, sessionId) => {
      accessCalls.push({ userId, role, sessionId })
      return `access:${sessionId}`
    },
    verifyAccess: () => ({ sub: 'u-1', role: 'user', session_id: 'sess-1' }),
    generateRefreshToken: () => {
      refreshSeq += 1
      return { token: `refresh-${refreshSeq}`, hash: `hash-${refreshSeq}` }
    },
    hashRefreshToken: (t) => `sha:${t}`,
    refreshLifetime: () => ({
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
      maxAgeMs: 30 * 86_400_000,
    }),
  }
  return { jwt, accessCalls }
}

function makeModuleRef(impl: () => Promise<unknown>) {
  const calls: Array<{
    playerId: string
    trackingCode?: string
    ip?: string
    userAgent?: string
  }> = []
  const facade = {
    attributePlayer: async (input: (typeof calls)[number]) => {
      calls.push(input)
      return impl()
    },
  }
  const moduleRef = { get: () => facade } as unknown as ModuleRef
  return { moduleRef, calls }
}

describe('RegisterUseCase', () => {
  const BASE = { email: 'User@Example.COM ', password: 'Str0ngPass!' }

  function makeUc(over: Parameters<typeof makeUsersRepo>[0] = {}) {
    const users = makeUsersRepo(over)
    const sessions = makeSessionsRepo()
    const verif = makeVerifRepo()
    const hasher = makeHasher()
    const email = makeEmail()
    const jwt = makeJwt()
    const uc = new RegisterUseCase(
      users.repo,
      sessions.repo,
      verif.repo,
      hasher.hasher,
      email.email,
      jwt.jwt,
    )
    return { uc, users, sessions, verif, hasher, email, jwt }
  }

  it('happy path: пользователь создан, код рефералки 8 символов, сессия и токены выданы', async () => {
    const d = makeUc()
    const res = await d.uc.execute(BASE, { ip: '127.0.0.1', userAgent: 'vitest' })

    expect(d.users.created).toHaveLength(1)
    const input = d.users.created[0]!
    expect(input.email).toBe('user@example.com')
    expect(input.passwordHash).toBe('hash:Str0ngPass!')
    expect(input.referredBy).toBeNull()
    expect(input.referralCode).toMatch(/^[A-Z2-9]{8}$/)
    expect(res.referralCode).toBe(input.referralCode)
    expect(res.user).toEqual({ id: 'u-1', email: 'user@example.com', role: 'user' })
    expect(res.refreshToken).toBe('refresh-1')
    expect(res.accessToken).toBe('access:sess-1')
    expect(res.message).toBe('Регистрация успешна')
    expect(d.sessions.createdInputs[0]!.ipAddress).toBe('127.0.0.1')
    expect(d.sessions.createdInputs[0]!.userAgent).toBe('vitest')
    expect(d.jwt.accessCalls[0]).toEqual({ userId: 'u-1', role: 'user', sessionId: 'sess-1' })
  })

  it('пароль короче 8 символов → WeakPasswordError, порты не трогаются', async () => {
    const d = makeUc()
    await expect(d.uc.execute({ ...BASE, password: 'short' })).rejects.toThrow(WeakPasswordError)
    expect(d.users.created).toHaveLength(0)
    expect(d.sessions.createdInputs).toHaveLength(0)
    expect(d.email.sent).toHaveLength(0)
  })

  it('email уже занят → EmailAlreadyExistsError, создания нет', async () => {
    const d = makeUc({ existing: makeUser() })
    await expect(d.uc.execute(BASE)).rejects.toThrow(EmailAlreadyExistsError)
    expect(d.users.created).toHaveLength(0)
  })

  it('email нормализуется (trim + lowercase) перед поиском и созданием', async () => {
    const d = makeUc()
    await d.uc.execute(BASE)
    expect(d.users.created[0]!.email).toBe('user@example.com')
  })

  it('известный код рефералки → referredBy = id реферера; неизвестный → null без падения', async () => {
    const referrer = makeUser({ id: 'u-ref', referralCode: 'ABC12345' })
    const withRef = makeUc({ referrer })
    await withRef.uc.execute({ ...BASE, referralCode: ' abc12345 ' })
    expect(withRef.users.created[0]!.referredBy).toBe('u-ref')

    const junkRef = makeUc()
    await junkRef.uc.execute({ ...BASE, referralCode: 'NO-SUCH-CODE' })
    expect(junkRef.users.created[0]!.referredBy).toBeNull()
  })

  it('письмо подтверждения отправлено с токеном на 24ч', async () => {
    const d = makeUc()
    const before = Date.now()
    await d.uc.execute(BASE)
    const rec = d.verif.created[0]!
    expect(rec.userId).toBe('u-1')
    expect(rec.token).toMatch(/^[0-9a-f]{64}$/)
    const hours = (rec.expiresAt.getTime() - before) / 3_600_000
    expect(hours).toBeGreaterThan(23.9)
    expect(hours).toBeLessThan(24.1)
    expect(d.email.sent).toEqual([{ to: 'user@example.com', token: rec.token }])
  })

  it('коллизия кода рефералки → повтор генерации; 5 коллизий → ReferralCodeGenerationError', async () => {
    let attempts = 0
    const retry = makeUc({ codeExists: () => (attempts += 1) <= 2 })
    await retry.uc.execute(BASE)
    expect(attempts).toBe(3)
    expect(retry.users.created).toHaveLength(1)

    const exhausted = makeUc({ codeExists: () => true })
    await expect(exhausted.uc.execute(BASE)).rejects.toThrow(ReferralCodeGenerationError)
    expect(exhausted.users.created).toHaveLength(0)
  })

  it('affiliate: с кодом партнёра атрибуция вызвана, ошибка атрибуции регистрацию не ломает', async () => {
    const ok = makeModuleRef(async () => 'attributed')
    const dOk = makeUc()
    const ucOk = new RegisterUseCase(
      dOk.users.repo,
      dOk.sessions.repo,
      dOk.verif.repo,
      dOk.hasher.hasher,
      dOk.email.email,
      dOk.jwt.jwt,
      ok.moduleRef,
    )
    await ucOk.execute(BASE, { ip: '10.0.0.1', affiliateCode: 'partner-1' })
    expect(ok.calls).toEqual([
      { playerId: 'u-1', trackingCode: 'partner-1', ip: '10.0.0.1', userAgent: undefined },
    ])

    const failing = makeModuleRef(async () => {
      throw new Error('affiliate down')
    })
    const dFail = makeUc()
    const ucFail = new RegisterUseCase(
      dFail.users.repo,
      dFail.sessions.repo,
      dFail.verif.repo,
      dFail.hasher.hasher,
      dFail.email.email,
      dFail.jwt.jwt,
      failing.moduleRef,
    )
    const res = await ucFail.execute(BASE, { affiliateCode: 'partner-1' })
    expect(res.user.id).toBe('u-1')
    expect(dFail.users.created).toHaveLength(1)
  })

  it('affiliate: без кода партнёра фасад не дёргается', async () => {
    const aff = makeModuleRef(async () => 'attributed')
    const d = makeUc()
    const uc = new RegisterUseCase(
      d.users.repo,
      d.sessions.repo,
      d.verif.repo,
      d.hasher.hasher,
      d.email.email,
      d.jwt.jwt,
      aff.moduleRef,
    )
    await uc.execute(BASE)
    expect(aff.calls).toHaveLength(0)
  })
})
