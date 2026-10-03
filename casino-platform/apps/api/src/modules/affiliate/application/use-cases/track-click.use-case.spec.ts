import { beforeEach, describe, expect, it } from 'vitest'

import { sanitizePath, FALLBACK_PATH, TrackClickUseCase } from './track-click.use-case'
import { type IpFingerprinter } from '../../domain/repositories/affiliate.repository'
import { parseRevShareRate } from '../../domain/value-objects/revshare-rate.value-object'

import type {
  AffiliateClickEntity,
  AffiliateEntity,
} from '../../__tests__/helpers/affiliate-test-types'

const CODE = 'ABCDEFGH'

function makeAffiliate(overrides: Partial<AffiliateEntity> = {}): AffiliateEntity {
  return {
    id: 'aff-1',
    userId: 'user-1',
    email: 'partner@example.com',
    passwordHash: 'hash',
    status: 'active',
    trackingCode: CODE,
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

/**
 * Фейк порта IpFingerprinter — обязан покрывать ВСЕ методы контракта.
 *
 * TrackClick записывает клик в try/catch с fail-open: если фейку не хватает
 * метода, вызов падает внутри try, ошибка глотается логом, и тест «клик
 * записан» тихо стал бы «клик не записан». Поэтому тип здесь — сам порт,
 * а не `as never`.
 */
function makeFingerprinter(): IpFingerprinter {
  return {
    hash: (ip: string): string => `hash-${ip}`,
    sanitizeUserAgent: (userAgent: string | null | undefined): string | null => userAgent ?? null,
    extractRefererHost: (referer: string | null | undefined): string | null => referer ?? null,
  }
}

describe('sanitizePath', () => {
  it('allows an internal casino path', () => {
    expect(sanitizePath('/casino/sweet-bonus')).toBe('/casino/sweet-bonus')
  })

  it('allows the bare casino root', () => {
    expect(sanitizePath('/casino')).toBe('/casino')
  })

  it('falls back when the path is missing', () => {
    expect(sanitizePath(undefined)).toBe(FALLBACK_PATH)
    expect(sanitizePath('')).toBe(FALLBACK_PATH)
  })

  it('blocks an absolute external url (open redirect)', () => {
    expect(sanitizePath('https://evil.example/phish')).toBe(FALLBACK_PATH)
  })

  it('blocks protocol-relative urls', () => {
    expect(sanitizePath('//evil.example/phish')).toBe(FALLBACK_PATH)
    expect(sanitizePath('/\\evil.example')).toBe(FALLBACK_PATH)
  })

  it('blocks paths outside the allowed catalogue', () => {
    expect(sanitizePath('/admin/users')).toBe(FALLBACK_PATH)
    expect(sanitizePath('/wallet')).toBe(FALLBACK_PATH)
  })

  it('blocks control characters and null bytes', () => {
    expect(sanitizePath('/casino/%00')).toBe(FALLBACK_PATH)
    expect(sanitizePath('/casino/\nSet-Cookie: x=1')).toBe(FALLBACK_PATH)
  })

  it('blocks an overlong path', () => {
    expect(sanitizePath(`/casino/${'a'.repeat(300)}`)).toBe(FALLBACK_PATH)
  })
})

describe('TrackClickUseCase', () => {
  let useCase: TrackClickUseCase
  let affiliate: AffiliateEntity | null
  let settings: { isEnabled: boolean; cookieDays: number }
  let recorded: Array<{ landingPath: string; ipHash: string }>
  let touched: number

  beforeEach(() => {
    affiliate = makeAffiliate()
    settings = { isEnabled: true, cookieDays: 30 }
    recorded = []
    touched = 0

    const affiliatesRepo = {
      findByTrackingCode: (): Promise<AffiliateEntity | null> => Promise.resolve(affiliate),
      touchLastClick: (): Promise<void> => {
        touched += 1
        return Promise.resolve()
      },
    }
    const clicksRepo = {
      create: (input: { landingPath: string; ipHash: string }): Promise<AffiliateClickEntity> => {
        recorded.push({ landingPath: input.landingPath, ipHash: input.ipHash })
        return Promise.resolve({
          id: '1',
          affiliateId: 'aff-1',
          landingPath: input.landingPath,
          ipHash: input.ipHash,
          userAgent: null,
          refererHost: null,
          geoCountry: null,
          campaignId: null,
          subId: null,
          isConverted: false,
          createdAt: new Date(),
        })
      },
    }
    const fingerprinter = makeFingerprinter()
    const settingsService = { get: (): Promise<typeof settings> => Promise.resolve(settings) }

    useCase = new TrackClickUseCase(
      affiliatesRepo as never,
      clicksRepo as never,
      fingerprinter,
      settingsService as never,
    )
  })

  it('records the click and sets the cookie for an active affiliate', async () => {
    const result = await useCase.execute({ trackingCode: CODE, path: '/casino/sweet' })

    expect(result.shouldSetCookie).toBe(true)
    expect(result.cookieCode).toBe(CODE)
    expect(result.redirectPath).toBe('/casino/sweet')
    expect(recorded).toHaveLength(1)
    expect(recorded[0]?.landingPath).toBe('/casino/sweet')
    expect(touched).toBe(1)
  })

  it('never sets a cookie for an unknown code', async () => {
    affiliate = null

    const result = await useCase.execute({ trackingCode: 'UNKNOWN1' })

    expect(result.shouldSetCookie).toBe(false)
    expect(result.cookieCode).toBeNull()
    expect(result.redirectPath).toBe(FALLBACK_PATH)
    expect(recorded).toHaveLength(0)
  })

  it('never sets a cookie for a suspended affiliate', async () => {
    affiliate = makeAffiliate({ status: 'suspended' })

    const result = await useCase.execute({ trackingCode: CODE })

    expect(result.shouldSetCookie).toBe(false)
    expect(recorded).toHaveLength(0)
  })

  it('never sets a cookie for a rejected affiliate', async () => {
    affiliate = makeAffiliate({ status: 'rejected' })

    const result = await useCase.execute({ trackingCode: CODE })

    expect(result.shouldSetCookie).toBe(false)
  })

  it('ignores the click entirely when the program is disabled', async () => {
    settings = { isEnabled: false, cookieDays: 30 }

    const result = await useCase.execute({ trackingCode: CODE })

    expect(result.shouldSetCookie).toBe(false)
    expect(recorded).toHaveLength(0)
  })

  it('falls back to the casino root for an external deep link', async () => {
    const result = await useCase.execute({ trackingCode: CODE, path: 'https://evil.example' })

    expect(result.redirectPath).toBe(FALLBACK_PATH)
    expect(recorded[0]?.landingPath).toBe(FALLBACK_PATH)
  })

  it('uses the configured cookie window', async () => {
    settings = { isEnabled: true, cookieDays: 90 }

    const result = await useCase.execute({ trackingCode: CODE })

    expect(result.cookieDays).toBe(90)
  })

  it('still redirects the user when the click cannot be recorded', async () => {
    const affiliatesRepo = {
      findByTrackingCode: (): Promise<AffiliateEntity> =>
        Promise.resolve(affiliate as AffiliateEntity),
      touchLastClick: (): Promise<void> => Promise.resolve(),
    }
    const failingClicks = {
      create: (): Promise<never> => Promise.reject(new Error('db down')),
    }
    const failOpen = new TrackClickUseCase(
      affiliatesRepo as never,
      failingClicks as never,
      makeFingerprinter(),
      { get: (): Promise<typeof settings> => Promise.resolve(settings) } as never,
    )

    const result = await failOpen.execute({ trackingCode: CODE, path: '/casino' })

    expect(result.shouldSetCookie).toBe(true)
    expect(result.redirectPath).toBe('/casino')
  })
})
