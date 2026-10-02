/**
 * Юнит-тесты ForgotPasswordUseCase (G21).
 *
 * Ключевой контракт — анти-энумерация: ответ одинаковый для существующего
 * и несуществующего email, письмо и токен создаются только для реального юзера.
 */
import { ForgotPasswordUseCase } from '../src/modules/auth/application/use-cases/forgot-password.use-case'
import { User } from '../src/modules/auth/domain/entities/user.entity'

import type { IEmailQueueService } from '../src/modules/auth/domain/auth.ports'
import type { UserProps } from '../src/modules/auth/domain/entities/user.entity'
import type { IUserRepository } from '../src/modules/auth/domain/repositories/user.repository'
import type {
  IPasswordResetRepository,
  VerificationTokenView,
} from '../src/modules/auth/domain/repositories/verification-token.repository'

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

function makeDeps(over: { user?: User | null } = {}) {
  const created: Array<{ userId: string; token: string; expiresAt: Date }> = []
  const resets: IPasswordResetRepository = {
    create: async (userId, token, expiresAt) => {
      created.push({ userId, token, expiresAt })
      return { id: 'r-1', userId, token, expiresAt, usedAt: null } as VerificationTokenView
    },
    findByToken: async () => null,
    markUsed: async () => {},
  }

  const users: IUserRepository = {
    findByEmail: async () => over.user ?? null,
    findById: async () => null,
    findByReferralCode: async () => null,
    referralCodeExists: async () => false,
    create: async () => makeUser(),
    update: async () => {},
  }

  const sent: Array<{ to: string; token: string }> = []
  const email: IEmailQueueService = {
    sendVerificationEmail: async () => 'queued',
    sendPasswordReset: async (to, token) => {
      sent.push({ to, token })
      return 'queued'
    },
  }

  const uc = new ForgotPasswordUseCase(users, resets, email)
  return { uc, created, sent }
}

describe('ForgotPasswordUseCase', () => {
  it('существующий email: токен на 1ч создан, письмо с тем же токеном отправлено', async () => {
    const d = makeDeps({ user: makeUser() })
    const before = Date.now()
    const res = await d.uc.execute('User@Example.COM ')

    const r = d.created[0]!
    expect(r.userId).toBe('u-1')
    expect(r.token).toMatch(/^[0-9a-f]{128}$/)
    const minutes = (r.expiresAt.getTime() - before) / 60_000
    expect(minutes).toBeGreaterThan(59)
    expect(minutes).toBeLessThan(61)
    expect(d.sent).toEqual([{ to: 'user@test.dev', token: r.token }])
    expect(res.message).toBe('If email exists, you will receive a link')
  })

  it('email нормализуется (trim + lowercase) перед поиском', async () => {
    let got: string | undefined
    const d = makeDeps({ user: makeUser() })
    // Подменяем поиск, чтобы поймать нормализованный аргумент
    const users = { findByEmail: async (e: string) => { got = e; return null } }
    const uc = new ForgotPasswordUseCase(
      users as unknown as IUserRepository,
      {
        create: async () => {
          throw new Error('not expected')
        },
        findByToken: async () => null,
        markUsed: async () => {},
      },
      { sendVerificationEmail: async () => 'queued', sendPasswordReset: async () => 'queued' },
    )
    await uc.execute('  MixedCase@Example.COM  ')
    expect(got).toBe('mixedcase@example.com')
    expect(d.created).toHaveLength(0)
  })

  it('несуществующий email: ни токена, ни письма — но ответ тот же (анти-энумерация)', async () => {
    const d = makeDeps({ user: null })
    const res = await d.uc.execute('ghost@test.dev')
    expect(d.created).toHaveLength(0)
    expect(d.sent).toHaveLength(0)
    expect(res.message).toBe('If email exists, you will receive a link')
  })
})
