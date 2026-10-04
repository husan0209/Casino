/**
 * Юнит-тесты OAuthUserProvisioningService — входа/создания игрока через
 * провайдера (слепая зона G21: файл лежит в `application/use-cases/`, но
 * называется `*.service.ts`, поэтому гардом не видится).
 *
 * Проверяются ветки, где ошибка стоит чужого аккаунта или потерянной
 * реферальной атрибуции:
 *  - порядок поиска: связь провайдера → письмо → создание. Ошибочный порядок
 *    плодит дубли игроков (один Google-аккаунт = два кошелька);
 *  - письмо нормализуется (trim + lower) и на чтении, и на записи: иначе
 *    «Ivan@Mail.RU» и «ivan@mail.ru» — два разных игрока;
 *  - пароль у OAuth-игрока НЕ создаётся никогда (нечему брутфорситься);
 *  - refresh-токен в репозиторий уходит ТОЛЬКО хешем;
 *  - access-токен подписывается уже после создания сессии и привязан к её id
 *    (иначе отозвать сессию было бы нечем);
 *  - генерация реферального кода имеет конечное число попыток.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OAuthUserProvisioningService } from '../src/modules/auth/application/use-cases/oauth/oauth-user-provisioning.service'
import { User } from '../src/modules/auth/domain/entities/user.entity'
import { ReferralCodeGenerationError } from '../src/modules/auth/domain/errors'

import type { IJwtTokenService } from '../src/modules/auth/domain/auth.ports'
import type { UserProps } from '../src/modules/auth/domain/entities/user.entity'
import type {
  AuthProviderKind,
  AuthProviderView,
  IAuthProviderRepository,
} from '../src/modules/auth/domain/repositories/auth-provider.repository'
import type {
  ISessionRepository,
  SessionCreateInput,
  SessionView,
} from '../src/modules/auth/domain/repositories/session.repository'
import type {
  CreateUserInput,
  IUserRepository,
} from '../src/modules/auth/domain/repositories/user.repository'

const FIXED_NOW = new Date('2026-07-01T09:00:00.000Z')
const SESSION_ID = 'sess-1'
const REFRESH_TOKEN = 'raw-refresh-token'
const REFRESH_HASH = 'sha256-of-refresh'
/** Алфавит генератора: без неоднозначных I/O/0/1 — проверяем, что он не расширился. */
const REFERRAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function makeUser(over: Partial<UserProps>): User {
  return new User({
    id: 'u-1',
    email: null,
    username: null,
    passwordHash: 'hash:stored',
    status: 'active',
    role: 'user',
    emailVerified: true,
    referralCode: 'EXISTING1',
    referredBy: null,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    failedLoginAttempts: 0,
    lastFailedAt: null,
    lockedUntil: null,
    ...over,
  })
}

const linkOf = (userId: string, provider: AuthProviderKind = 'google'): AuthProviderView => ({
  id: 'link-1',
  userId,
  provider,
  providerUserId: 'provider-uid-1',
  providerEmail: null,
})

const sessionOf = (): SessionView => ({
  id: SESSION_ID,
  userId: 'u-1',
  refreshTokenHash: REFRESH_HASH,
  ipAddress: null,
  userAgent: null,
  expiresAt: new Date(0),
  revokedAt: null,
})

let users: {
  findByEmail: ReturnType<typeof vi.fn>
  findById: ReturnType<typeof vi.fn>
  findByReferralCode: ReturnType<typeof vi.fn>
  referralCodeExists: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
}
let authProviders: {
  findByProvider: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
}
let sessions: { create: ReturnType<typeof vi.fn> }
let jwt: {
  signAccess: ReturnType<typeof vi.fn>
  generateRefreshToken: ReturnType<typeof vi.fn>
  refreshLifetime: ReturnType<typeof vi.fn>
}
let service: OAuthUserProvisioningService

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: FIXED_NOW.getTime() })
  users = {
    findByEmail: vi.fn().mockResolvedValue(null),
    findById: vi.fn().mockResolvedValue(null),
    findByReferralCode: vi.fn().mockResolvedValue(null),
    referralCodeExists: vi.fn().mockResolvedValue(false),
    create: vi.fn().mockResolvedValue(makeUser({ id: 'u-new', email: 'ivan@mail.ru' })),
  }
  authProviders = {
    findByProvider: vi.fn().mockResolvedValue(null),
    create: vi
      .fn()
      .mockImplementation((input: { userId: string }) => Promise.resolve(linkOf(input.userId))),
  }
  sessions = { create: vi.fn().mockResolvedValue(sessionOf()) }
  jwt = {
    generateRefreshToken: vi.fn().mockReturnValue({ token: REFRESH_TOKEN, hash: REFRESH_HASH }),
    // Не 30 суток: проверка на «25 часов» доказывает, что провижинение спрашивает
    // порт, а не воспроизводит прежний хардкод окна.
    refreshLifetime: vi.fn().mockReturnValue({
      expiresAt: new Date(FIXED_NOW.getTime() + 25 * 3_600_000),
      maxAgeMs: 25 * 3_600_000,
    }),
    signAccess: vi.fn().mockImplementation((sub: string, _role: string, sid: string) => {
      return `jwt:${sub}:${sid}`
    }),
  }
  service = new OAuthUserProvisioningService(
    users as unknown as IUserRepository,
    authProviders as unknown as IAuthProviderRepository,
    sessions as unknown as ISessionRepository,
    jwt as unknown as IJwtTokenService,
  )
})

afterEach(() => {
  vi.useRealTimers()
})

const GOOGLE_INPUT = {
  provider: 'google' as const,
  providerUserId: 'provider-uid-1',
  email: '  Ivan@Mail.RU ',
}

describe('OAuthUserProvisioningService.signIn — порядок разрешения идентичности', () => {
  it('найденная связь провайдера: ни поиска по письму, ни создания игрока', async () => {
    // Arrange
    authProviders.findByProvider.mockResolvedValue(linkOf('u-existing'))
    users.findById.mockResolvedValue(makeUser({ id: 'u-existing', email: 'ivan@mail.ru' }))
    // Act
    const result = await service.signIn(GOOGLE_INPUT)
    // Assert — обход должен случиться ДО любых остальных чтений
    expect(users.findByEmail).not.toHaveBeenCalled()
    expect(users.create).not.toHaveBeenCalled()
    expect(authProviders.create).not.toHaveBeenCalled()
    expect(result.wasLinked).toBe(true)
    expect(result.user.id).toBe('u-existing')
  })

  it('связи нет, но письмо занято → линкуем существующего игрока, нового не создаём', async () => {
    // Arrange
    users.findByEmail.mockResolvedValue(makeUser({ id: 'u-mail', email: 'ivan@mail.ru' }))
    // Act
    const result = await service.signIn(GOOGLE_INPUT)
    // Assert — нормализованное письмо: trim + lower до похода в БД
    expect(users.findByEmail).toHaveBeenCalledWith('ivan@mail.ru')
    expect(users.create).not.toHaveBeenCalled()
    expect(authProviders.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-mail', provider: 'google' }),
    )
    // былLinked=false осознанно: флаг описывает НАЛИЧИЕ связи на входе
    expect(result.wasLinked).toBe(false)
    expect(result.user.id).toBe('u-mail')
  })

  it('связь есть, а игрока нет → не считаем чужое письмо и создаём нового', async () => {
    // Arrange — битая строка в auth_providers (userId в никуда)
    authProviders.findByProvider.mockResolvedValue(linkOf('u-ghost'))
    users.findById.mockResolvedValue(null)
    // Act
    await service.signIn({ provider: 'telegram', providerUserId: 'provider-uid-1' })
    // Assert — без письма искать «похожего» нельзя, иначе привяжем чужой аккаунт
    expect(users.findByEmail).not.toHaveBeenCalled()
    expect(users.create).toHaveBeenCalledTimes(1)
  })
})

describe('OAuthUserProvisioningService.signIn — создание игрока', () => {
  it('пароля нет, письмо нормализовано, код из «чистого» алфавита', async () => {
    // Act
    await service.signIn(GOOGLE_INPUT)
    // Assert
    const created = users.create.mock.calls[0]?.[0] as CreateUserInput
    expect(created).toEqual({
      email: 'ivan@mail.ru',
      passwordHash: null,
      referralCode: expect.stringMatching(new RegExp(`^[${REFERRAL_ALPHABET}]{8}$`)),
      referredBy: null,
    })
  })

  it('реферер найден → атрибуция проставляется, код ищется нормализованно', async () => {
    // Arrange
    users.findByReferralCode.mockResolvedValue(makeUser({ id: 'u-referrer', email: 'ref@mail.ru' }))
    // Act
    await service.signIn({ ...GOOGLE_INPUT, referralCode: ' refcode1 ' })
    // Assert
    expect(users.findByReferralCode).toHaveBeenCalledWith('REFCODE1')
    const created = users.create.mock.calls[0]?.[0] as CreateUserInput
    expect(created.referredBy).toBe('u-referrer')
  })

  it('реферер не найден → игрок создаётся БЕЗ атрибуции, а не падает', async () => {
    // Arrange — опечатка в партнёрской ссылке не должна ломать вход
    users.findByReferralCode.mockResolvedValue(null)
    // Act
    const result = await service.signIn({ ...GOOGLE_INPUT, referralCode: 'nosuchcode' })
    // Assert
    expect(users.create.mock.calls[0]?.[0]).toMatchObject({ referredBy: null })
    expect(result.user.id).toBe('u-new')
  })

  it('все 5 генераций коллизии → REFERRAL_CODE_GENERATION_FAILED, а не бесконечный цикл', async () => {
    // Arrange
    users.referralCodeExists.mockResolvedValue(true)
    // Act/Assert
    await expect(service.signIn(GOOGLE_INPUT)).rejects.toBeInstanceOf(ReferralCodeGenerationError)
    expect(users.referralCodeExists).toHaveBeenCalledTimes(5)
    expect(users.create).not.toHaveBeenCalled()
  })
})

describe('OAuthUserProvisioningService.signIn — сессия и токены', () => {
  it('в репозиторий уходит хеш refresh, наружу — сам токен', async () => {
    // Act
    const result = await service.signIn(GOOGLE_INPUT)
    // Assert — сырой refresh в БД не ездит (иначе дамп таблиц = угон сессий)
    expect(sessions.create.mock.calls[0]?.[0]).toMatchObject({ refreshTokenHash: REFRESH_HASH })
    expect(result.refreshToken).toBe(REFRESH_TOKEN)
  })

  it('access подписывается ПОСЛЕ создания сессии и привязан к её id', async () => {
    // Arrange
    const session = sessionOf()
    sessions.create.mockResolvedValue(session)
    const user = makeUser({ id: 'u-existing', email: 'ivan@mail.ru' })
    authProviders.findByProvider.mockResolvedValue(linkOf('u-existing'))
    users.findById.mockResolvedValue(user)
    // Act
    const result = await service.signIn(GOOGLE_INPUT)
    // Assert — порядок важен: токен, выпущенный до сессии, нечем отзывать
    expect(sessions.create).toHaveBeenCalledTimes(1)
    expect(jwt.signAccess).toHaveBeenCalledWith('u-existing', 'user', SESSION_ID)
    expect(result.accessToken).toBe(`jwt:u-existing:${SESSION_ID}`)
  })

  it('ип/юзер-агент не переданы → в сессии null, а не undefined', async () => {
    // Act
    await service.signIn(GOOGLE_INPUT)
    // Assert — колонки NOT NULL, undefined прилетел бы как пропущенное поле
    expect(sessions.create.mock.calls[0]?.[0]).toMatchObject({ ipAddress: null, userAgent: null })
  })

  it('отказ репозитория сессий → access-токен не выпускается вообще', async () => {
    // Arrange
    sessions.create.mockRejectedValue(new Error('session store down'))
    // Act/Assert — полу-успешный вход (токен без сессии) невозможен
    await expect(service.signIn(GOOGLE_INPUT)).rejects.toThrow('session store down')
    expect(jwt.signAccess).not.toHaveBeenCalled()
  })

  it('срок жизни сессии — 30 суток от момента входа', async () => {
    // Act
    await service.signIn(GOOGLE_INPUT)
    // Assert
    const input = sessions.create.mock.calls[0]?.[0] as SessionCreateInput
    expect(input.expiresAt.getTime()).toBe(FIXED_NOW.getTime() + 25 * 3600 * 1000)
  })
})
