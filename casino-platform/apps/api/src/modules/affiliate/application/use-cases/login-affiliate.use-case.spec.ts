import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LoginAffiliateUseCase } from './login-affiliate.use-case'
import { type IAffiliateJwtService } from '../../domain/affiliate.ports'
import {
  AffiliateCredentialsInvalidError,
  AffiliateNotActiveError,
} from '../../domain/errors/affiliate.errors'
import { type AffiliateRepository } from '../../domain/repositories/affiliate.repository'
import { parseRevShareRate } from '../../domain/value-objects/revshare-rate.value-object'

import type { AffiliateEntity } from '../../__tests__/helpers/affiliate-test-types'

// argon2 в юнит-тестах не нужен: реальный хеш стоит ~100 мс и делает прогон
// зависимым от настроек CPU. Через vi.hoisted, иначе фабрика мока выполнится
// раньше инициализации переменных.
const { hashMock, verifyMock } = vi.hoisted(() => ({
  hashMock: vi.fn(async (_plain: string): Promise<string> => 'unused-hash'),
  verifyMock: vi.fn(async (_hash: string, _plain: string): Promise<boolean> => true),
}))

vi.mock('argon2', () => ({
  hash: (plain: string) => hashMock(plain),
  verify: (hash: string, plain: string) => verifyMock(hash, plain),
}))

const APP_URL_KEY = 'APP_URL'
let originalAppUrl: string | undefined

function makeAffiliate(overrides: Partial<AffiliateEntity> = {}): AffiliateEntity {
  return {
    id: 'aff-1',
    userId: 'user-1',
    email: 'partner@example.com',
    passwordHash: 'stored-hash',
    status: 'active',
    trackingCode: 'ABCDEFGH',
    displayName: null,
    country: null,
    telegram: null,
    website: null,
    trafficSources: [],
    revshareRate: parseRevShareRate('0.2'),
    payoutCurrency: 'RUB',
    totalEarned: '0',
    totalPaid: '0',
    isAgreed: true,
    agreedAt: new Date(),
    suspendedReason: null,
    lastClickAt: null,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function makeRepo(affiliate: AffiliateEntity | null): {
  repo: AffiliateRepository
  findByEmail: ReturnType<typeof vi.fn>
  touchLastLogin: ReturnType<typeof vi.fn>
} {
  const findByEmail = vi.fn(async (_email: string): Promise<AffiliateEntity | null> => affiliate)
  const touchLastLogin = vi.fn(async (_id: string): Promise<void> => undefined)
  const repo = { findByEmail, touchLastLogin } as unknown as AffiliateRepository
  return { repo, findByEmail, touchLastLogin }
}

function makeJwt(): { jwt: IAffiliateJwtService; signAccess: ReturnType<typeof vi.fn> } {
  const signAccess = vi.fn((_id: string, _email: string): string => 'issued-token')
  const jwt = { signAccess } as unknown as IAffiliateJwtService
  return { jwt, signAccess }
}

describe('LoginAffiliateUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hashMock.mockResolvedValue('unused-hash')
    verifyMock.mockResolvedValue(true)
    originalAppUrl = process.env[APP_URL_KEY]
    process.env[APP_URL_KEY] = 'http://localhost:3000'
  })

  afterEach(() => {
    if (originalAppUrl === undefined) {
      delete process.env[APP_URL_KEY]
      return
    }
    process.env[APP_URL_KEY] = originalAppUrl
  })

  it('normalizes the email before the lookup', async () => {
    const { repo, findByEmail } = makeRepo(makeAffiliate())
    const { jwt } = makeJwt()

    await new LoginAffiliateUseCase(repo, jwt).execute({
      email: '  Partner@Example.COM ',
      password: 'secret',
    })

    expect(findByEmail).toHaveBeenCalledWith('partner@example.com')
  })

  it('rejects an unknown email with the generic credentials error', async () => {
    const { repo } = makeRepo(null)
    const { jwt } = makeJwt()

    await expect(
      new LoginAffiliateUseCase(repo, jwt).execute({ email: 'nobody@example.com', password: 'x' }),
    ).rejects.toBeInstanceOf(AffiliateCredentialsInvalidError)
  })

  it('still burns an argon2 hash for an unknown email (timing defence)', async () => {
    const { repo, touchLastLogin } = makeRepo(null)
    const { jwt } = makeJwt()

    await expect(
      new LoginAffiliateUseCase(repo, jwt).execute({ email: 'nobody@example.com', password: 'x' }),
    ).rejects.toBeInstanceOf(AffiliateCredentialsInvalidError)

    expect(hashMock).toHaveBeenCalledWith('x')
    expect(touchLastLogin).not.toHaveBeenCalled()
  })

  it('verifies the password against the stored hash', async () => {
    const { repo } = makeRepo(makeAffiliate())
    const { jwt } = makeJwt()

    await new LoginAffiliateUseCase(repo, jwt).execute({
      email: 'partner@example.com',
      password: 'secret',
    })

    expect(verifyMock).toHaveBeenCalledWith('stored-hash', 'secret')
  })

  it('rejects a wrong password', async () => {
    verifyMock.mockResolvedValue(false)
    const { repo, touchLastLogin } = makeRepo(makeAffiliate())
    const { jwt } = makeJwt()

    await expect(
      new LoginAffiliateUseCase(repo, jwt).execute({
        email: 'partner@example.com',
        password: 'wrong',
      }),
    ).rejects.toBeInstanceOf(AffiliateCredentialsInvalidError)
    expect(touchLastLogin).not.toHaveBeenCalled()
  })

  it('treats a throwing argon2.verify as a wrong password', async () => {
    // Повреждённый хеш в БД не должен приводить к 500 — это тот же отказ.
    verifyMock.mockRejectedValue(new Error('corrupt hash'))
    const { repo } = makeRepo(makeAffiliate())
    const { jwt } = makeJwt()

    await expect(
      new LoginAffiliateUseCase(repo, jwt).execute({
        email: 'partner@example.com',
        password: 'secret',
      }),
    ).rejects.toBeInstanceOf(AffiliateCredentialsInvalidError)
  })

  it('does not let a suspended partner in', async () => {
    const { repo, touchLastLogin } = makeRepo(makeAffiliate({ status: 'suspended' }))
    const { jwt, signAccess } = makeJwt()

    await expect(
      new LoginAffiliateUseCase(repo, jwt).execute({
        email: 'partner@example.com',
        password: 'secret',
      }),
    ).rejects.toBeInstanceOf(AffiliateNotActiveError)
    expect(touchLastLogin).not.toHaveBeenCalled()
    expect(signAccess).not.toHaveBeenCalled()
  })

  it('does not let a rejected partner in', async () => {
    const { repo } = makeRepo(makeAffiliate({ status: 'rejected' }))
    const { jwt } = makeJwt()

    await expect(
      new LoginAffiliateUseCase(repo, jwt).execute({
        email: 'partner@example.com',
        password: 'secret',
      }),
    ).rejects.toBeInstanceOf(AffiliateNotActiveError)
  })

  it('returns the cabinet payload and stamps the last login on success', async () => {
    const { repo, touchLastLogin } = makeRepo(
      makeAffiliate({ revshareRate: parseRevShareRate('0.2500') }),
    )
    const { jwt, signAccess } = makeJwt()

    const result = await new LoginAffiliateUseCase(repo, jwt).execute({
      email: 'partner@example.com',
      password: 'secret',
    })

    expect(result).toEqual({
      affiliateId: 'aff-1',
      trackingCode: 'ABCDEFGH',
      trackingUrl: 'http://localhost:3000/go/ABCDEFGH',
      revshareRate: '0.2500',
      status: 'active',
      accessToken: 'issued-token',
    })
    expect(touchLastLogin).toHaveBeenCalledWith('aff-1')
    expect(signAccess).toHaveBeenCalledWith('aff-1', 'partner@example.com')
  })

  it('strips trailing slashes from APP_URL when building the tracking link', async () => {
    process.env[APP_URL_KEY] = 'https://partner.example.com///'
    const { repo } = makeRepo(makeAffiliate())
    const { jwt } = makeJwt()

    const result = await new LoginAffiliateUseCase(repo, jwt).execute({
      email: 'partner@example.com',
      password: 'secret',
    })

    expect(result.trackingUrl).toBe('https://partner.example.com/go/ABCDEFGH')
  })
})
