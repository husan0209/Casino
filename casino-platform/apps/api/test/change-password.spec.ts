/**
 * GAP-52: юнит-тесты ChangePasswordUseCase (ТЗ ч.5 §9 «Безопасность»).
 * Проверяемые контракты:
 *   1) слабый новый пароль → WeakPasswordError (порог 8 — как в register/reset);
 *   2) OAuth-аккаунт без пароля → PasswordNotSetError (не INVALID_CREDENTIALS:
 *      фронт прячет форму по hasPassword, но API-контракт должен быть явным);
 *   3) неверный текущий пароль → InvalidCredentialsError;
 *   4) happy path: хеш обновлён, сессии отозваны КРОМЕ текущей.
 */
import {
  InvalidCredentialsError,
  PasswordNotSetError,
  WeakPasswordError,
} from '../src/modules/auth/domain/errors'
import { User, type UserProps } from '../src/modules/auth/domain/entities/user.entity'
import { ChangePasswordUseCase } from '../src/modules/auth/application/use-cases/change-password.use-case'
import type { ISessionRepository } from '../src/modules/auth/domain/repositories/session.repository'
import type { IUserRepository } from '../src/modules/auth/domain/repositories/user.repository'
import type { PasswordHasher } from '../src/modules/auth/infrastructure/services/password-hasher.service'

function makeUser(passwordHash: string | null): User {
  const props: UserProps = {
    id: 'u1',
    email: 'user@example.com',
    username: null,
    passwordHash,
    status: 'active',
    role: 'user',
    emailVerified: true,
    referralCode: 'REF1',
    referredBy: null,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    failedLoginAttempts: 0,
    lastFailedAt: null,
    lockedUntil: null,
  }
  return new User(props)
}

function makeHarness(passwordHash: string | null): {
  useCase: ChangePasswordUseCase
  users: IUserRepository
  sessions: ISessionRepository
} {
  const user = makeUser(passwordHash)
  const users: IUserRepository = {
    findByEmail: vi.fn(),
    findById: vi.fn().mockResolvedValue(user),
    findByReferralCode: vi.fn(),
    referralCodeExists: vi.fn(),
    create: vi.fn(),
    update: vi.fn().mockResolvedValue(undefined),
  }
  const sessions: ISessionRepository = {
    create: vi.fn(),
    findByRefreshTokenHash: vi.fn(),
    revoke: vi.fn(),
    revokeAllUserSessions: vi.fn(),
    revokeAllUserSessionsExcept: vi.fn().mockResolvedValue(undefined),
  }
  const hasher = {
    hash: vi.fn().mockResolvedValue('new-hash'),
    verify: vi.fn().mockImplementation((hash, plain) => Promise.resolve(hash === 'old-hash' && plain === 'correct')),
  } as unknown as PasswordHasher
  return { useCase: new ChangePasswordUseCase(users, sessions, hasher), users, sessions }
}

describe('GAP-52 ChangePasswordUseCase', () => {
  const input = {
    userId: 'u1',
    currentPassword: 'correct',
    newPassword: 'new-password-1',
    currentSessionId: 's-current',
  }

  it('rejects weak new password (< 8 chars) with WEAK_PASSWORD', async () => {
    const { useCase } = makeHarness('old-hash')
    await expect(useCase.execute({ ...input, newPassword: 'short1' })).rejects.toThrow(WeakPasswordError)
  })

  it('rejects OAuth account without password with PASSWORD_NOT_SET, not INVALID_CREDENTIALS', async () => {
    const { useCase } = makeHarness(null)
    await expect(useCase.execute(input)).rejects.toThrow(PasswordNotSetError)
  })

  it('rejects wrong current password with INVALID_CREDENTIALS', async () => {
    const { useCase } = makeHarness('old-hash')
    await expect(useCase.execute({ ...input, currentPassword: 'wrong' })).rejects.toThrow(InvalidCredentialsError)
  })

  it('happy path: updates hash and revokes all sessions EXCEPT the current one', async () => {
    const { useCase, users, sessions } = makeHarness('old-hash')
    const result = await useCase.execute(input)
    expect(result).toEqual({ ok: true })
    expect(users.update).toHaveBeenCalledTimes(1)
    expect((users.update as ReturnType<typeof vi.fn>).mock.calls[0][0].passwordHash).toBe('new-hash')
    expect(sessions.revokeAllUserSessionsExcept).toHaveBeenCalledWith('u1', 's-current')
    expect(sessions.revokeAllUserSessions).not.toHaveBeenCalled()
  })
})
