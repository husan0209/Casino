import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AFFILIATE_SETTINGS_DEFAULTS,
  type AffiliateSettings,
} from '../../domain/affiliate-settings'
import {
  AffiliateAlreadyExistsError,
  PlayerReferralCodeGenerationError,
} from '../../domain/errors/affiliate.errors'
import {
  type AffiliatePlayerProvisioningRepository,
  type AffiliateRepository,
} from '../../domain/repositories/affiliate.repository'
import { type AffiliateJwtService } from '../../infrastructure/affiliate-jwt.service'
import { type AffiliateSettingsService } from '../affiliate-settings.service'
import { RegisterAffiliateUseCase } from './register-affiliate.use-case'

import type { AffiliateEntity } from '../../__tests__/helpers/affiliate-test-types'

const { hashMock } = vi.hoisted(() => ({
  hashMock: vi.fn(async (_plain: string, _opts?: unknown): Promise<string> => 'stored-hash'),
}))

vi.mock('argon2', () => ({
  hash: (plain: string, options?: unknown) => hashMock(plain, options),
  argon2id: 2,
}))

const APP_URL_KEY = 'APP_URL'
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const REFERRAL_CODE_PREFIX = 'aff'
let originalAppUrl: string | undefined

function makeAffiliate(overrides: Partial<AffiliateEntity> = {}): AffiliateEntity {
  return {
    id: 'aff-1',
    userId: 'player-1',
    email: 'partner@example.com',
    passwordHash: 'stored-hash',
    status: 'active',
    trackingCode: 'ABCDEFGH',
    displayName: null,
    country: null,
    telegram: null,
    website: null,
    trafficSources: [],
    revshareRate: '0.2000',
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

function makeDeps(
  options: {
    existing?: AffiliateEntity | null
    settings?: Partial<AffiliateSettings>
    create?: (input: unknown) => Promise<AffiliateEntity>
    isReferralCodeAvailable?: (code: string) => Promise<boolean>
  } = {},
): {
  affiliates: AffiliateRepository
  players: AffiliatePlayerProvisioningRepository
  settings: AffiliateSettingsService
  jwt: AffiliateJwtService
  findByEmail: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
  createPlayerUser: ReturnType<typeof vi.fn>
  deletePlayerUser: ReturnType<typeof vi.fn>
  isPlayerReferralCodeAvailable: ReturnType<typeof vi.fn>
  signAccess: ReturnType<typeof vi.fn>
} {
  const findByEmail = vi.fn(
    async (_email: string): Promise<AffiliateEntity | null> => options.existing ?? null,
  )
  const generateUniqueTrackingCode = vi.fn(async (): Promise<string> => 'ABCDEFGH')
  const create = vi.fn(async (input: unknown): Promise<AffiliateEntity> => {
    if (options.create) {
      return options.create(input)
    }
    const payload = input as {
      userId: string
      email: string
      passwordHash: string
      trackingCode: string
      revshareRate: string
    }
    return makeAffiliate({
      id: 'aff-new',
      userId: payload.userId,
      email: payload.email,
      passwordHash: payload.passwordHash,
      trackingCode: payload.trackingCode,
      revshareRate: payload.revshareRate,
    })
  })
  const createPlayerUser = vi.fn(async (_args: { referralCode: string }) => ({ id: 'player-1' }))
  const deletePlayerUser = vi.fn(async (_userId: string): Promise<void> => undefined)
  const isPlayerReferralCodeAvailable = vi.fn(async (_code: string): Promise<boolean> =>
    options.isReferralCodeAvailable === undefined ? true : options.isReferralCodeAvailable(_code),
  )
  const signAccess = vi.fn((_id: string, _email: string): string => 'issued-token')

  return {
    affiliates: {
      findByEmail,
      generateUniqueTrackingCode,
      create,
    } as unknown as AffiliateRepository,
    players: {
      createPlayerUser,
      deletePlayerUser,
      isPlayerReferralCodeAvailable,
    } as unknown as AffiliatePlayerProvisioningRepository,
    settings: {
      get: async () => ({ ...AFFILIATE_SETTINGS_DEFAULTS, ...options.settings }),
    } as unknown as AffiliateSettingsService,
    jwt: { signAccess } as unknown as AffiliateJwtService,
    findByEmail,
    create,
    createPlayerUser,
    deletePlayerUser,
    isPlayerReferralCodeAvailable,
    signAccess,
  }
}

const VALID_INPUT = { email: 'partner@example.com', password: 'secret', acceptTerms: true }

describe('RegisterAffiliateUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hashMock.mockResolvedValue('stored-hash')
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

  it('normalizes the email before the duplicate check', async () => {
    const deps = makeDeps()

    await new RegisterAffiliateUseCase(
      deps.affiliates,
      deps.players,
      deps.settings,
      deps.jwt,
    ).execute({ ...VALID_INPUT, email: '  Partner@Example.COM ' })

    expect(deps.findByEmail).toHaveBeenCalledWith('partner@example.com')
  })

  it('refuses a duplicate email without provisioning a player', async () => {
    const deps = makeDeps({ existing: makeAffiliate() })

    await expect(
      new RegisterAffiliateUseCase(deps.affiliates, deps.players, deps.settings, deps.jwt).execute(
        VALID_INPUT,
      ),
    ).rejects.toBeInstanceOf(AffiliateAlreadyExistsError)
    expect(deps.createPlayerUser).not.toHaveBeenCalled()
    expect(deps.create).not.toHaveBeenCalled()
  })

  it('takes the revshare rate from the program settings (admin-configurable)', async () => {
    const deps = makeDeps({ settings: { defaultRevshareRate: '0.3500' } })

    const result = await new RegisterAffiliateUseCase(
      deps.affiliates,
      deps.players,
      deps.settings,
      deps.jwt,
    ).execute(VALID_INPUT)

    expect(result.revshareRate).toBe('0.3500')
    expect(deps.create).toHaveBeenCalledWith(expect.objectContaining({ revshareRate: '0.3500' }))
  })

  it('rejects a rate outside [0,1] from settings', async () => {
    const deps = makeDeps({ settings: { defaultRevshareRate: '1.5' } })

    await expect(
      new RegisterAffiliateUseCase(deps.affiliates, deps.players, deps.settings, deps.jwt).execute(
        VALID_INPUT,
      ),
    ).rejects.toThrow()
    expect(deps.createPlayerUser).not.toHaveBeenCalled()
  })

  it('hashes the password with argon2id', async () => {
    const deps = makeDeps()

    await new RegisterAffiliateUseCase(
      deps.affiliates,
      deps.players,
      deps.settings,
      deps.jwt,
    ).execute(VALID_INPUT)

    expect(hashMock).toHaveBeenCalledWith('secret', { type: 2 })
    expect(deps.create).toHaveBeenCalledWith(
      expect.objectContaining({ passwordHash: 'stored-hash' }),
    )
  })

  it('provisions a separate player user with an "aff"-prefixed referral code', async () => {
    const deps = makeDeps()

    await new RegisterAffiliateUseCase(
      deps.affiliates,
      deps.players,
      deps.settings,
      deps.jwt,
    ).execute(VALID_INPUT)

    expect(deps.createPlayerUser).toHaveBeenCalledTimes(1)
    const args = deps.createPlayerUser.mock.calls[0]?.[0] as { referralCode: string }
    expect(args.referralCode.startsWith(REFERRAL_CODE_PREFIX)).toBe(true)
    expect(args.referralCode).toHaveLength(REFERRAL_CODE_PREFIX.length + 8)
    for (const char of args.referralCode.slice(REFERRAL_CODE_PREFIX.length)) {
      expect(CODE_ALPHABET).toContain(char)
    }
  })

  it('retries the referral code while candidates are taken', async () => {
    let calls = 0
    const deps = makeDeps({
      isReferralCodeAvailable: () => {
        calls += 1
        return Promise.resolve(calls > 2)
      },
    })

    await new RegisterAffiliateUseCase(
      deps.affiliates,
      deps.players,
      deps.settings,
      deps.jwt,
    ).execute(VALID_INPUT)

    expect(deps.isPlayerReferralCodeAvailable).toHaveBeenCalledTimes(3)
    expect(deps.create).toHaveBeenCalledTimes(1)
  })

  it('fails after every referral-code candidate is taken', async () => {
    const deps = makeDeps({ isReferralCodeAvailable: () => Promise.resolve(false) })

    await expect(
      new RegisterAffiliateUseCase(deps.affiliates, deps.players, deps.settings, deps.jwt).execute(
        VALID_INPUT,
      ),
    ).rejects.toBeInstanceOf(PlayerReferralCodeGenerationError)
    expect(deps.create).not.toHaveBeenCalled()
  })

  it('deletes the provisioned player when the affiliate write fails', async () => {
    const boom = new Error('unique violation on email')
    const deps = makeDeps({
      create: () => Promise.reject(boom),
    })

    await expect(
      new RegisterAffiliateUseCase(deps.affiliates, deps.players, deps.settings, deps.jwt).execute(
        VALID_INPUT,
      ),
    ).rejects.toBe(boom)
    expect(deps.deletePlayerUser).toHaveBeenCalledWith('player-1')
  })

  it('rethrows the original failure even if the compensating delete also fails', async () => {
    const boom = new Error('unique violation on email')
    const deps = makeDeps({ create: () => Promise.reject(boom) })
    deps.deletePlayerUser.mockRejectedValue(new Error('cleanup failed'))

    await expect(
      new RegisterAffiliateUseCase(deps.affiliates, deps.players, deps.settings, deps.jwt).execute(
        VALID_INPUT,
      ),
    ).rejects.toBe(boom)
  })

  it('returns the cabinet payload and signs a token on success', async () => {
    const deps = makeDeps({ settings: { defaultRevshareRate: '0.2000' } })

    const result = await new RegisterAffiliateUseCase(
      deps.affiliates,
      deps.players,
      deps.settings,
      deps.jwt,
    ).execute({ ...VALID_INPUT, displayName: 'Webmaster' })

    expect(result).toEqual({
      affiliateId: 'aff-new',
      trackingCode: 'ABCDEFGH',
      trackingUrl: 'http://localhost:3000/go/ABCDEFGH',
      revshareRate: '0.2000',
      accessToken: 'issued-token',
      message: 'Партнёр зарегистрирован',
    })
    expect(deps.signAccess).toHaveBeenCalledWith('aff-new', 'partner@example.com')
    expect(deps.create).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Webmaster' }))
  })

  it('stores absent optional fields as null', async () => {
    const deps = makeDeps()

    await new RegisterAffiliateUseCase(
      deps.affiliates,
      deps.players,
      deps.settings,
      deps.jwt,
    ).execute(VALID_INPUT)

    // country намеренно не проверяется: use-case его не передаёт — страна
    // определяется гео-контекстом игрока, а не формой регистрации партнёра.
    expect(deps.create).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: null,
        telegram: null,
        website: null,
        payoutCurrency: 'RUB',
        isAgreed: true,
      }),
    )
  })
})
