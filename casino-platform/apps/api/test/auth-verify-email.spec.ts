/**
 * Юнит-тесты VerifyEmailUseCase (G21): happy path, отказы портов, краевые случаи.
 *
 * Порты — in-memory фейки: repo токенов отдаёт запись через findByToken,
 * сессии и jwt пишут вызовы в массивы.
 */
import { VerifyEmailUseCase } from '../src/modules/auth/application/use-cases/verify-email.use-case'
import { User } from '../src/modules/auth/domain/entities/user.entity'
import {
  TokenAlreadyUsedError,
  TokenExpiredError,
  TokenInvalidError,
} from '../src/modules/auth/domain/errors'

import type { IJwtTokenService } from '../src/modules/auth/domain/auth.ports'
import type { UserProps } from '../src/modules/auth/domain/entities/user.entity'
import type {
  ISessionRepository,
  SessionCreateInput,
  SessionView,
} from '../src/modules/auth/domain/repositories/session.repository'
import type { IUserRepository } from '../src/modules/auth/domain/repositories/user.repository'
import type {
  IEmailVerificationRepository,
  VerificationTokenView,
} from '../src/modules/auth/domain/repositories/verification-token.repository'

const TOKEN = 'a'.repeat(64)

function makeUser(over: Partial<UserProps> = {}): User {
  return new User({
    id: 'u-1',
    email: 'user@test.dev',
    username: null,
    passwordHash: 'hash:old',
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

function makeDeps(over: { rec?: VerificationTokenView | null; user?: User | null } = {}) {
  const updated: User[] = []
  const users: IUserRepository = {
    findByEmail: async () => null,
    findById: async () => over.user ?? null,
    findByReferralCode: async () => null,
    referralCodeExists: async () => false,
    create: async () => makeUser(),
    update: async (u) => {
      updated.push(u)
    },
  }

  const markedUsed: string[] = []
  const verif: IEmailVerificationRepository = {
    create: async () => {
      throw new Error('not expected in this spec')
    },
    findByToken: async () => over.rec ?? null,
    markUsed: async (id) => {
      markedUsed.push(id)
    },
  }

  const createdInputs: SessionCreateInput[] = []
  const sessions: ISessionRepository = {
    create: async (input) => {
      createdInputs.push(input)
      return { id: 'sess-1', ...input } as SessionView
    },
    findByRefreshTokenHash: async () => null,
    revoke: async () => {},
    revokeAllUserSessions: async () => {},
    revokeAllUserSessionsExcept: async () => {},
  }

  const accessCalls: Array<{ userId: string; role: string; sessionId: string }> = []
  const jwt: IJwtTokenService = {
    signAccess: (userId, role, sessionId) => {
      accessCalls.push({ userId, role, sessionId })
      return `access:${sessionId}`
    },
    verifyAccess: () => ({ sub: 'u-1', role: 'user', session_id: 'sess-1' }),
    generateRefreshToken: () => ({ token: 'refresh-2', hash: 'hash-2' }),
    hashRefreshToken: (t) => `sha:${t}`,
  }

  const uc = new VerifyEmailUseCase(users, verif, sessions, jwt)
  return { uc, updated, markedUsed, createdInputs, accessCalls }
}

function rec(over: Partial<VerificationTokenView> = {}): VerificationTokenView {
  return {
    id: 'v-1',
    userId: 'u-1',
    token: TOKEN,
    expiresAt: new Date(Date.now() + 3_600_000),
    usedAt: null,
    ...over,
  }
}

describe('VerifyEmailUseCase', () => {
  it('happy path: email помечен подтверждённым, токен помечен used, сессия создана', async () => {
    const d = makeDeps({ rec: rec(), user: makeUser() })
    const res = await d.uc.execute(TOKEN, '127.0.0.1', 'vitest')

    expect(d.updated).toHaveLength(1)
    expect(d.updated[0]!.emailVerified).toBe(true)
    expect(d.markedUsed).toEqual(['v-1'])
    expect(res.user).toEqual({ id: 'u-1', email: 'user@test.dev', role: 'user' })
    expect(res.refreshToken).toBe('refresh-2')
    expect(res.accessToken).toBe('access:sess-1')
    expect(d.accessCalls[0]).toEqual({ userId: 'u-1', role: 'user', sessionId: 'sess-1' })
  })

  it('ip/userAgent не переданы → в сессии null, а не undefined', async () => {
    const d = makeDeps({ rec: rec(), user: makeUser() })
    await d.uc.execute(TOKEN)
    expect(d.createdInputs[0]!.ipAddress).toBeNull()
    expect(d.createdInputs[0]!.userAgent).toBeNull()
  })

  it('сессия живёт 30 дней', async () => {
    const d = makeDeps({ rec: rec(), user: makeUser() })
    const before = Date.now()
    await d.uc.execute(TOKEN)
    const days = (d.createdInputs[0]!.expiresAt.getTime() - before) / 86_400_000
    expect(days).toBeGreaterThan(29.9)
    expect(days).toBeLessThan(30.1)
  })

  it('неизвестный токен → TokenInvalidError', async () => {
    const d = makeDeps({ rec: null })
    await expect(d.uc.execute(TOKEN)).rejects.toThrow(TokenInvalidError)
    expect(d.markedUsed).toHaveLength(0)
  })

  it('токен уже использован → TokenAlreadyUsedError', async () => {
    const d = makeDeps({ rec: rec({ usedAt: new Date() }), user: makeUser() })
    await expect(d.uc.execute(TOKEN)).rejects.toThrow(TokenAlreadyUsedError)
    expect(d.updated).toHaveLength(0)
  })

  it('токен истёк → TokenExpiredError', async () => {
    const d = makeDeps({ rec: rec({ expiresAt: new Date(Date.now() - 1000) }), user: makeUser() })
    await expect(d.uc.execute(TOKEN)).rejects.toThrow(TokenExpiredError)
    expect(d.updated).toHaveLength(0)
  })

  it('пользователь удалён → TokenInvalidError, markUsed не вызывается', async () => {
    const d = makeDeps({ rec: rec(), user: null })
    await expect(d.uc.execute(TOKEN)).rejects.toThrow(TokenInvalidError)
    expect(d.markedUsed).toHaveLength(0)
    expect(d.createdInputs).toHaveLength(0)
  })
})
