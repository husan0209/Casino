/**
 * Юнит-тесты RefreshUseCase (G21): ротация refresh-токена.
 *
 * Старая сессия ревокается, создаётся новая (ip переезжает, userAgent
 * сбрасывается), access подписывается от новой сессии. Блокированный
 * или отсутствующий юзер → AccountBlockedError (не раскрываем причину).
 */
import { RefreshUseCase } from '../src/modules/auth/application/use-cases/refresh.use-case'
import { User } from '../src/modules/auth/domain/entities/user.entity'
import {
  AccountBlockedError,
  SessionExpiredError,
  SessionInvalidError,
} from '../src/modules/auth/domain/errors'

import type { IJwtTokenService } from '../src/modules/auth/domain/auth.ports'
import type { UserProps } from '../src/modules/auth/domain/entities/user.entity'
import type {
  ISessionRepository,
  SessionCreateInput,
  SessionView,
} from '../src/modules/auth/domain/repositories/session.repository'
import type { IUserRepository } from '../src/modules/auth/domain/repositories/user.repository'

const REFRESH = 'refresh-raw'

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

function makeSession(over: Partial<SessionView> = {}): SessionView {
  return {
    id: 'sess-old',
    userId: 'u-1',
    refreshTokenHash: 'sha:old',
    ipAddress: '10.0.0.1',
    userAgent: 'old-agent',
    expiresAt: new Date(Date.now() + 3_600_000),
    revokedAt: null,
    ...over,
  }
}

function makeDeps(over: { session?: SessionView | null; user?: User | null } = {}) {
  const lookedUpHashes: string[] = []
  const revoked: string[] = []
  const createdInputs: SessionCreateInput[] = []
  const sessions: ISessionRepository = {
    create: async (input) => {
      createdInputs.push(input)
      return { id: 'sess-new', ...input } as SessionView
    },
    findByRefreshTokenHash: async (hash) => {
      lookedUpHashes.push(hash)
      return over.session ?? null
    },
    revoke: async (id) => {
      revoked.push(id)
    },
    revokeAllUserSessions: async () => {},
    revokeAllUserSessionsExcept: async () => {},
  }

  const users: IUserRepository = {
    findByEmail: async () => null,
    findById: async () => over.user ?? null,
    findByReferralCode: async () => null,
    referralCodeExists: async () => false,
    create: async () => makeUser(),
    update: async () => {},
  }

  const accessCalls: Array<{ userId: string; role: string; sessionId: string }> = []
  const jwt: IJwtTokenService = {
    signAccess: (userId, role, sessionId) => {
      accessCalls.push({ userId, role, sessionId })
      return `access:${sessionId}`
    },
    verifyAccess: () => ({ sub: 'u-1', role: 'user', session_id: 'sess-1' }),
    generateRefreshToken: () => ({ token: 'refresh-new', hash: 'sha:new' }),
    hashRefreshToken: (t) => `sha:${t}`,
    // Не 30 суток — иначе тест не отличает «порт спросили» от «посчитали сами».
    refreshLifetime: () => ({
      expiresAt: new Date(Date.now() + 25 * 3_600_000),
      maxAgeMs: 25 * 3_600_000,
    }),
  }

  const uc = new RefreshUseCase(sessions, users, jwt)
  return { uc, lookedUpHashes, revoked, createdInputs, accessCalls }
}

describe('RefreshUseCase', () => {
  it('happy path: старая сессия ревокается, новая создана, access от новой сессии', async () => {
    const d = makeDeps({ session: makeSession(), user: makeUser() })
    const res = await d.uc.execute(REFRESH)

    expect(d.lookedUpHashes).toEqual(['sha:refresh-raw'])
    expect(d.revoked).toEqual(['sess-old'])
    expect(res).toEqual({ accessToken: 'access:sess-new', refreshToken: 'refresh-new' })
    expect(d.accessCalls[0]).toEqual({ userId: 'u-1', role: 'user', sessionId: 'sess-new' })
  })

  it('новая сессия: ip и устройство наследуются, срок берётся из порта', async () => {
    const d = makeDeps({ session: makeSession(), user: makeUser() })
    const before = Date.now()
    await d.uc.execute(REFRESH)
    const created = d.createdInputs[0]!
    expect(created.userId).toBe('u-1')
    expect(created.refreshTokenHash).toBe('sha:new')
    expect(created.ipAddress).toBe('10.0.0.1')
    // Прежняя сборка обнуляла userAgent: ротация происходит на каждой полной
    // загрузке страницы, поэтому уже после первого refresh устройство исчезало из
    // `/users/sessions`, где поле отдаётся игроку (users.controller.ts:168).
    expect(created.userAgent).toBe('old-agent')
    const hours = (created.expiresAt.getTime() - before) / 3_600_000
    expect(hours).toBeGreaterThan(24.9)
    expect(hours).toBeLessThan(25.1)
  })

  it('сессии нет → SessionInvalidError', async () => {
    const d = makeDeps({ session: null, user: makeUser() })
    await expect(d.uc.execute(REFRESH)).rejects.toThrow(SessionInvalidError)
    expect(d.createdInputs).toHaveLength(0)
  })

  it('сессия отозвана → SessionInvalidError', async () => {
    const d = makeDeps({ session: makeSession({ revokedAt: new Date() }), user: makeUser() })
    await expect(d.uc.execute(REFRESH)).rejects.toThrow(SessionInvalidError)
  })

  it('сессия истекла → SessionExpiredError', async () => {
    const d = makeDeps({
      session: makeSession({ expiresAt: new Date(Date.now() - 1000) }),
      user: makeUser(),
    })
    await expect(d.uc.execute(REFRESH)).rejects.toThrow(SessionExpiredError)
  })

  it('юзер заблокирован → AccountBlockedError', async () => {
    const d = makeDeps({ session: makeSession(), user: makeUser({ status: 'blocked' }) })
    await expect(d.uc.execute(REFRESH)).rejects.toThrow(AccountBlockedError)
  })

  it('юзер отсутствует → AccountBlockedError (как заблокированный)', async () => {
    const d = makeDeps({ session: makeSession(), user: null })
    await expect(d.uc.execute(REFRESH)).rejects.toThrow(AccountBlockedError)
  })
})
