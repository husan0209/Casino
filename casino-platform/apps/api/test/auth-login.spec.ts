/**
 * Юнит-тесты LoginUseCase (G21): вход по email/паролю.
 *
 * Покрываются ветки, которые нельзя проверить «на глаз», потому что они
 * про безопасность, а не про удобство:
 *  - капча проверяется ДО argon2 (у бот-волны не должно быть шанса сжигать
 *    CPU на хешировании, GAP-55 (ж) §5.2);
 *  - неверный пароль на заблокированном аккаунте даёт INVALID_CREDENTIALS,
 *    а не ACCOUNT_LOCKED (иначе ответ раскрывает существование аккаунта),
 *    и счётчик неудач не продлевается (DoS чужими лог-инами);
 *  - successful login чистит lockout-состояние и создаёт сессию с хешем
 *    refresh-токена (сырой токен в БД не ездит).
 *
 * Порты — in-memory фейки: репозитории, хешер, JWT, капча.
 */
import { LoginUseCase } from '../src/modules/auth/application/use-cases/login.use-case'
import { User } from '../src/modules/auth/domain/entities/user.entity'
import {
  AccountBlockedError,
  AccountLockedError,
  CaptchaFailedError,
  InvalidCredentialsError,
  SelfExcludedError,
} from '../src/modules/auth/domain/errors'

import type {
  ICaptchaService,
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
  IUserSettingsRepository,
  SelfExclusionStatus,
} from '../src/modules/auth/domain/repositories/user-settings.repository'
import type { IUserRepository } from '../src/modules/auth/domain/repositories/user.repository'

const PASSWORD = 'correct horse battery staple'
const CAPTCHA_THRESHOLD = 5

function makeUser(over: Partial<UserProps> = {}): User {
  return new User({
    id: 'u-1',
    email: 'user@test.dev',
    username: null,
    passwordHash: 'hash:stored',
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

/**
 * Дефолтный lockout-профиль use-case (env не задан) — 10 неудач за 15 минут.
 * Тестам нужен только «второй неудачный вход в окне», он не зависит от лимита.
 */
const INSIDE_LOCKOUT_WINDOW = new Date()

type DepOverrides = {
  user?: User | null
  passwordOk?: boolean
  selfExclusion?: SelfExclusionStatus | null
  captchaAccepts?: boolean
}

function makeDeps(over: DepOverrides = {}) {
  const emailLookups: string[] = []
  const updated: User[] = []

  const users: IUserRepository = {
    findByEmail: async (email) => {
      emailLookups.push(email)
      return over.user === undefined ? makeUser() : over.user
    },
    findById: async () => null,
    findByReferralCode: async () => null,
    referralCodeExists: async () => false,
    create: async () => makeUser(),
    update: async (user) => {
      updated.push(user)
    },
  }

  const createdSessions: SessionCreateInput[] = []
  const sessions: ISessionRepository = {
    create: async (input) => {
      createdSessions.push(input)
      return { id: 'sess-1', ...input } as SessionView
    },
    findByRefreshTokenHash: async () => null,
    revoke: async () => {},
    revokeAllUserSessions: async () => {},
    revokeAllUserSessionsExcept: async () => {},
  }

  const selfExclusionLookups: string[] = []
  const userSettings: IUserSettingsRepository = {
    findSelfExclusion: async (userId) => {
      selfExclusionLookups.push(userId)
      return over.selfExclusion ?? null
    },
  }

  const hashChecks: Array<{ hash: string; plain: string }> = []
  const hasher: IPasswordHasher = {
    hash: async (plain) => `hash:${plain}`,
    verify: async (hash, plain) => {
      hashChecks.push({ hash, plain })
      return over.passwordOk !== false
    },
  }

  const accessCalls: Array<{ userId: string; role: string; sessionId: string }> = []
  const jwt: IJwtTokenService = {
    signAccess: (userId, role, sessionId) => {
      accessCalls.push({ userId, role, sessionId })
      return `access:${sessionId}`
    },
    verifyAccess: () => ({ sub: 'u-1', role: 'user', session_id: 'sess-1' }),
    generateRefreshToken: () => ({ token: 'refresh-raw', hash: 'sha:refresh' }),
    hashRefreshToken: (token) => `sha:${token}`,
  }

  const captchaVerifications: Array<string | undefined> = []
  const captcha: ICaptchaService = {
    transport: async () => ({ success: true }),
    siteKey: 'site-key',
    enabled: true,
    threshold: CAPTCHA_THRESHOLD,
    isRequiredFor: (failedAttempts) => failedAttempts >= CAPTCHA_THRESHOLD,
    verify: async (captchaToken) => {
      captchaVerifications.push(captchaToken)
      if (over.captchaAccepts === false) {
        throw new CaptchaFailedError('bad-answer')
      }
    },
  }

  const uc = new LoginUseCase(users, sessions, userSettings, hasher, jwt, captcha)
  return {
    uc,
    emailLookups,
    updated,
    createdSessions,
    selfExclusionLookups,
    hashChecks,
    accessCalls,
    captchaVerifications,
  }
}

const LOGIN_INPUT = {
  email: '  User@Test.dev  ',
  password: PASSWORD,
  ip: '10.0.0.7',
  userAgent: 'vitest-agent',
}

describe('LoginUseCase', () => {
  it('happy path: токены выданы, сессия в БД по хешу refresh, lockout-состояние сброшено', async () => {
    const d = makeDeps({
      user: makeUser({ failedLoginAttempts: 3, lastFailedAt: INSIDE_LOCKOUT_WINDOW }),
    })
    const res = await d.uc.execute(LOGIN_INPUT)

    // email нормализуется до запроса в репозиторий
    expect(d.emailLookups).toEqual(['user@test.dev'])
    expect(res).toEqual({
      accessToken: 'access:sess-1',
      refreshToken: 'refresh-raw',
      user: { id: 'u-1', email: 'user@test.dev', role: 'user' },
    })
    expect(d.createdSessions).toHaveLength(1)
    expect(d.createdSessions[0]!.refreshTokenHash).toBe('sha:refresh')
    expect(d.createdSessions[0]!.userId).toBe('u-1')
    expect(d.createdSessions[0]!.ipAddress).toBe('10.0.0.7')
    expect(d.createdSessions[0]!.userAgent).toBe('vitest-agent')
    expect(d.accessCalls).toEqual([{ userId: 'u-1', role: 'user', sessionId: 'sess-1' }])

    expect(d.updated).toHaveLength(1)
    expect(d.updated[0]!.props.failedLoginAttempts).toBe(0)
    expect(d.updated[0]!.props.lastFailedAt).toBeNull()
    expect(d.updated[0]!.props.lastLoginAt).toBeInstanceOf(Date)
  })

  it('сессия живёт 30 дней (окно refresh-токена)', async () => {
    const d = makeDeps()
    const before = Date.now()
    await d.uc.execute(LOGIN_INPUT)
    const days = (d.createdSessions[0]!.expiresAt.getTime() - before) / 86_400_000
    expect(days).toBeGreaterThan(29.9)
    expect(days).toBeLessThan(30.1)
  })

  it('аккаунта нет → InvalidCredentialsError, хешер не трогается', async () => {
    const d = makeDeps({ user: null })
    await expect(d.uc.execute(LOGIN_INPUT)).rejects.toThrow(InvalidCredentialsError)
    expect(d.hashChecks).toHaveLength(0)
    expect(d.createdSessions).toHaveLength(0)
  })

  it('OAuth-аккаунт без пароля → InvalidCredentialsError (вход паролем недоступен)', async () => {
    const d = makeDeps({ user: makeUser({ passwordHash: null }) })
    await expect(d.uc.execute(LOGIN_INPUT)).rejects.toThrow(InvalidCredentialsError)
    expect(d.hashChecks).toHaveLength(0)
  })

  it('неверный пароль → InvalidCredentialsError и зарегистрированная неудача', async () => {
    const d = makeDeps({ user: makeUser(), passwordOk: false })
    await expect(d.uc.execute(LOGIN_INPUT)).rejects.toThrow(InvalidCredentialsError)
    expect(d.updated).toHaveLength(1)
    expect(d.updated[0]!.props.failedLoginAttempts).toBe(1)
    expect(d.createdSessions).toHaveLength(0)
  })

  it('капча обязательна после порога неудач и проверяется ДО argon2', async () => {
    const d = makeDeps({ user: makeUser({ failedLoginAttempts: CAPTCHA_THRESHOLD }) })
    await d.uc.execute({ ...LOGIN_INPUT, captchaToken: 'turnstile-token' })
    expect(d.captchaVerifications).toEqual(['turnstile-token'])
    expect(d.hashChecks).toHaveLength(1)
  })

  it('капча не пройдена → CaptchaFailedError, пароль даже не проверяется', async () => {
    const d = makeDeps({
      user: makeUser({ failedLoginAttempts: CAPTCHA_THRESHOLD + 1 }),
      captchaAccepts: false,
    })
    await expect(d.uc.execute({ ...LOGIN_INPUT, captchaToken: 'wrong' })).rejects.toThrow(
      CaptchaFailedError,
    )
    expect(d.captchaVerifications).toEqual(['wrong'])
    expect(d.hashChecks).toHaveLength(0)
    expect(d.updated).toHaveLength(0)
  })

  it('ниже порога неудач капча не запрашивается', async () => {
    const d = makeDeps({ user: makeUser({ failedLoginAttempts: CAPTCHA_THRESHOLD - 1 }) })
    await d.uc.execute(LOGIN_INPUT)
    expect(d.captchaVerifications).toHaveLength(0)
  })

  it('заблокированный аккаунт + верный пароль → AccountLockedError с датой разблокировки', async () => {
    const lockedUntil = new Date(Date.now() + 30 * 60_000)
    const d = makeDeps({ user: makeUser({ lockedUntil }) })
    const err = await d.uc.execute(LOGIN_INPUT).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AccountLockedError)
    expect((err as AccountLockedError).lockedUntil).toEqual(lockedUntil)
    expect(d.createdSessions).toHaveLength(0)
  })

  it('заблокированный аккаунт + неверный пароль → InvalidCredentialsError, счётчик не продлевается', async () => {
    const d = makeDeps({
      user: makeUser({ lockedUntil: new Date(Date.now() + 30 * 60_000), failedLoginAttempts: 2 }),
      passwordOk: false,
    })
    await expect(d.uc.execute(LOGIN_INPUT)).rejects.toThrow(InvalidCredentialsError)
    expect(d.updated).toHaveLength(0)
  })

  it('истёкшая блокировка не мешает входу', async () => {
    const d = makeDeps({ user: makeUser({ lockedUntil: new Date(Date.now() - 1000) }) })
    await expect(d.uc.execute(LOGIN_INPUT)).resolves.toMatchObject({ accessToken: 'access:sess-1' })
  })

  it('заблокированный модератором аккаунт → AccountBlockedError', async () => {
    const d = makeDeps({ user: makeUser({ status: 'blocked' }) })
    await expect(d.uc.execute(LOGIN_INPUT)).rejects.toThrow(AccountBlockedError)
    expect(d.createdSessions).toHaveLength(0)
  })

  it('self-exclusion активен → SelfExcludedError, сессия не создаётся', async () => {
    const excludedUntil = new Date(Date.now() + 24 * 3_600_000)
    const d = makeDeps({ selfExclusion: { excludedUntil } })
    const err = await d.uc.execute(LOGIN_INPUT).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SelfExcludedError)
    expect((err as SelfExcludedError).excludedUntil).toEqual(excludedUntil)
    expect(d.selfExclusionLookups).toEqual(['u-1'])
    expect(d.createdSessions).toHaveLength(0)
  })

  it('аккаунт без email в БД (OAuth-пользователь с паролем): вход проходит, email в ответе null', async () => {
    const d = makeDeps({ user: makeUser({ email: null }) })
    const res = await d.uc.execute({ email: 'ghost@test.dev', password: PASSWORD })
    expect(res.user.email).toBeNull()
  })
})
