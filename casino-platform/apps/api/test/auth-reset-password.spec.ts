/**
 * Юнит-тесты ResetPasswordUseCase (G21): happy path, отказы портов, краевые случаи.
 *
 * После успешного сброса пароля все сессии пользователя отзываются.
 */
import { ResetPasswordUseCase } from '../src/modules/auth/application/use-cases/reset-password.use-case'
import { User } from '../src/modules/auth/domain/entities/user.entity'
import {
  TokenAlreadyUsedError,
  TokenExpiredError,
  TokenInvalidError,
  WeakPasswordError,
} from '../src/modules/auth/domain/errors'

import type { IPasswordHasher } from '../src/modules/auth/domain/auth.ports'
import type { UserProps } from '../src/modules/auth/domain/entities/user.entity'
import type { ISessionRepository } from '../src/modules/auth/domain/repositories/session.repository'
import type { IUserRepository } from '../src/modules/auth/domain/repositories/user.repository'
import type {
  IPasswordResetRepository,
  VerificationTokenView,
} from '../src/modules/auth/domain/repositories/verification-token.repository'

const TOKEN = 'b'.repeat(64)

function makeUser(over: Partial<UserProps> = {}): User {
  return new User({
    id: 'u-1',
    email: 'user@test.dev',
    username: null,
    passwordHash: 'hash:old',
    status: 'active',
    role: 'user',
    emailVerified: true,
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

  let findByTokenCalls = 0
  const markedUsed: string[] = []
  const resets: IPasswordResetRepository = {
    create: async () => {
      throw new Error('not expected in this spec')
    },
    findByToken: async () => {
      findByTokenCalls += 1
      return over.rec ?? null
    },
    markUsed: async (id) => {
      markedUsed.push(id)
    },
  }

  const revokedAll: string[] = []
  const sessions: ISessionRepository = {
    create: async () => {
      throw new Error('not expected in this spec')
    },
    findByRefreshTokenHash: async () => null,
    revoke: async () => {},
    revokeAllUserSessions: async (userId) => {
      revokedAll.push(userId)
    },
    revokeAllUserSessionsExcept: async () => {},
  }

  const hashed: string[] = []
  const hasher: IPasswordHasher = {
    hash: async (plain) => {
      hashed.push(plain)
      return `hash:${plain}`
    },
    verify: async () => true,
  }

  const uc = new ResetPasswordUseCase(resets, users, sessions, hasher)
  return { uc, updated, markedUsed, revokedAll, hashed, get findByTokenCalls() { return findByTokenCalls } }
}

function rec(over: Partial<VerificationTokenView> = {}): VerificationTokenView {
  return {
    id: 'r-1',
    userId: 'u-1',
    token: TOKEN,
    expiresAt: new Date(Date.now() + 3_600_000),
    usedAt: null,
    ...over,
  }
}

describe('ResetPasswordUseCase', () => {
  it('happy path: хеш нового пароля записан, токен used, все сессии отозваны', async () => {
    const user = makeUser()
    const d = makeDeps({ rec: rec(), user })
    const res = await d.uc.execute(TOKEN, 'NewStr0ngPass!')

    expect(res).toEqual({ ok: true })
    expect(d.hashed).toEqual(['NewStr0ngPass!'])
    expect(user.passwordHash).toBe('hash:NewStr0ngPass!')
    expect(d.updated).toEqual([user])
    expect(d.markedUsed).toEqual(['r-1'])
    expect(d.revokedAll).toEqual(['u-1'])
  })

  it('короткий пароль → WeakPasswordError ещё до поиска токена', async () => {
    const d = makeDeps({ rec: rec(), user: makeUser() })
    await expect(d.uc.execute(TOKEN, 'short')).rejects.toThrow(WeakPasswordError)
    expect(d.findByTokenCalls).toBe(0)
    expect(d.revokedAll).toHaveLength(0)
  })

  it('неизвестный токен → TokenInvalidError', async () => {
    const d = makeDeps({ rec: null, user: makeUser() })
    await expect(d.uc.execute(TOKEN, 'NewStr0ngPass!')).rejects.toThrow(TokenInvalidError)
    expect(d.updated).toHaveLength(0)
    expect(d.revokedAll).toHaveLength(0)
  })

  it('токен уже использован → TokenAlreadyUsedError', async () => {
    const d = makeDeps({ rec: rec({ usedAt: new Date() }), user: makeUser() })
    await expect(d.uc.execute(TOKEN, 'NewStr0ngPass!')).rejects.toThrow(TokenAlreadyUsedError)
    expect(d.updated).toHaveLength(0)
  })

  it('токен истёк → TokenExpiredError', async () => {
    const d = makeDeps({ rec: rec({ expiresAt: new Date(Date.now() - 1000) }), user: makeUser() })
    await expect(d.uc.execute(TOKEN, 'NewStr0ngPass!')).rejects.toThrow(TokenExpiredError)
    expect(d.updated).toHaveLength(0)
  })

  it('пользователь удалён → TokenInvalidError, сессии не трогаются', async () => {
    const d = makeDeps({ rec: rec(), user: null })
    await expect(d.uc.execute(TOKEN, 'NewStr0ngPass!')).rejects.toThrow(TokenInvalidError)
    expect(d.markedUsed).toHaveLength(0)
    expect(d.revokedAll).toHaveLength(0)
  })
})
