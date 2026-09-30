import { beforeEach, describe, expect, it } from 'vitest'

import { AttributePlayerUseCase } from '../application/use-cases/attribute-player.use-case'
import { parseRevShareRate } from '../domain/value-objects/revshare-rate.value-object'

import type { AffiliateAttributionEntity, AffiliateEntity } from './helpers/affiliate-test-types'

const CODE = 'ABCDEFGH'
const PLAYER_ID = 'player-1'

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

describe('AttributePlayerUseCase', () => {
  let useCase: AttributePlayerUseCase
  let affiliate: AffiliateEntity | null
  let lastClick: {
    ipHash: string | null
    userAgent: string | null
    clickId: string | null
    createdAt: Date | null
  }
  let existingAttribution: AffiliateAttributionEntity | null
  let createdAttributions: Array<{
    status: string
    rejectReason: string | null
    isSelfReferral: boolean
  }>
  let qualifiedByIp: number
  let convertedClicks: string[]
  let settings: { isEnabled: boolean; autoSuspendThreshold: number }

  beforeEach(() => {
    affiliate = makeAffiliate()
    lastClick = {
      ipHash: 'hash-203.0.113.7',
      userAgent: 'Mozilla/5.0 (partner)',
      clickId: '10',
      createdAt: new Date(),
    }
    existingAttribution = null
    createdAttributions = []
    qualifiedByIp = 0
    convertedClicks = []
    settings = { isEnabled: true, autoSuspendThreshold: 20 }

    const affiliatesRepo = {
      findByTrackingCode: (): Promise<AffiliateEntity | null> => Promise.resolve(affiliate),
    }
    const attributionsRepo = {
      findByPlayerId: (): Promise<AffiliateAttributionEntity | null> =>
        Promise.resolve(existingAttribution),
      create: (input: {
        status: string
        rejectReason?: string | null
        isSelfReferral?: boolean
      }): Promise<AffiliateAttributionEntity> => {
        createdAttributions.push({
          status: input.status,
          rejectReason: input.rejectReason ?? null,
          isSelfReferral: input.isSelfReferral ?? false,
        })
        return Promise.resolve({
          id: 'attr-1',
          affiliateId: 'aff-1',
          playerId: PLAYER_ID,
          clickId: '10',
          status: input.status as AffiliateAttributionEntity['status'],
          qualifiedAt: null,
          firstDepositId: null,
          firstDepositAt: null,
          totalDeposit: '0',
          depositCount: 0,
          isSelfReferral: input.isSelfReferral ?? false,
          rejectReason: null,
          createdAt: new Date(),
        })
      },
    }
    const clicksRepo = {
      findLastByAffiliate: (): Promise<typeof lastClick> => Promise.resolve(lastClick),
      markConverted: (clickId: string): Promise<void> => {
        convertedClicks.push(clickId)
        return Promise.resolve()
      },
      countQualifiedByIpHash: (): Promise<number> => Promise.resolve(qualifiedByIp),
    }
    const fingerprinter = { hash: (ip: string): string => `hash-${ip}` }
    const settingsService = { get: (): Promise<typeof settings> => Promise.resolve(settings) }

    useCase = new AttributePlayerUseCase(
      affiliatesRepo as never,
      attributionsRepo as never,
      clicksRepo as never,
      fingerprinter as never,
      settingsService as never,
    )
  })

  it('attributes a player who arrived with a valid code', async () => {
    const result = await useCase.execute({
      playerId: PLAYER_ID,
      trackingCode: CODE,
      ip: '198.51.100.9',
    })

    expect(result).toEqual({ attributed: true, affiliateId: 'aff-1', reason: 'attributed' })
    expect(createdAttributions[0]?.status).toBe('pending')
    expect(convertedClicks).toEqual(['10'])
  })

  it('does nothing without a code', async () => {
    const result = await useCase.execute({ playerId: PLAYER_ID })

    expect(result.reason).toBe('no_code')
    expect(createdAttributions).toHaveLength(0)
  })

  it('does nothing for an unknown code', async () => {
    affiliate = null

    const result = await useCase.execute({ playerId: PLAYER_ID, trackingCode: 'NOPE' })

    expect(result.reason).toBe('unknown_code')
  })

  it('does nothing when the program is disabled', async () => {
    settings = { isEnabled: false, autoSuspendThreshold: 20 }

    const result = await useCase.execute({ playerId: PLAYER_ID, trackingCode: CODE })

    expect(result.reason).toBe('program_disabled')
  })

  it('does not attribute a player to a suspended affiliate', async () => {
    affiliate = makeAffiliate({ status: 'suspended' })

    const result = await useCase.execute({ playerId: PLAYER_ID, trackingCode: CODE })

    expect(result.reason).toBe('not_active')
    expect(createdAttributions).toHaveLength(0)
  })

  it('never re-attributes a player who already belongs to another affiliate', async () => {
    existingAttribution = {
      id: 'attr-existing',
      affiliateId: 'aff-other',
      playerId: PLAYER_ID,
      clickId: null,
      status: 'qualified',
      qualifiedAt: new Date(),
      firstDepositId: null,
      firstDepositAt: new Date(),
      totalDeposit: '100',
      depositCount: 1,
      isSelfReferral: false,
      rejectReason: null,
      createdAt: new Date(),
    }

    const result = await useCase.execute({ playerId: PLAYER_ID, trackingCode: CODE })

    expect(result).toEqual({ attributed: false, affiliateId: null, reason: 'already_attributed' })
    expect(createdAttributions).toHaveLength(0)
  })

  it('rejects a self-referral detected by matching ip (rule F1)', async () => {
    const result = await useCase.execute({
      playerId: PLAYER_ID,
      trackingCode: CODE,
      ip: '203.0.113.7',
    })

    expect(result).toEqual({ attributed: false, affiliateId: null, reason: 'self_referral' })
    expect(createdAttributions[0]).toMatchObject({
      status: 'rejected',
      isSelfReferral: true,
      rejectReason: 'self_referral',
    })
  })

  it('rejects a self-referral detected by matching user agent (rule F2)', async () => {
    const result = await useCase.execute({
      playerId: PLAYER_ID,
      trackingCode: CODE,
      ip: '198.51.100.9',
      userAgent: 'Mozilla/5.0 (partner)',
    })

    expect(result.reason).toBe('self_referral')
    expect(createdAttributions[0]?.status).toBe('rejected')
  })

  it('suspends attribution when one ip floods past the threshold (rule F3)', async () => {
    qualifiedByIp = 25
    settings = { isEnabled: true, autoSuspendThreshold: 20 }

    const result = await useCase.execute({
      playerId: PLAYER_ID,
      trackingCode: CODE,
      ip: '198.51.100.9',
    })

    expect(result.reason).toBe('self_referral')
    expect(createdAttributions[0]).toMatchObject({ status: 'rejected', rejectReason: 'ip_flood' })
  })

  it('still attributes below the flood threshold', async () => {
    qualifiedByIp = 5

    const result = await useCase.execute({
      playerId: PLAYER_ID,
      trackingCode: CODE,
      ip: '198.51.100.9',
    })

    expect(result.reason).toBe('attributed')
  })

  it('attributes without ip signals when none are available', async () => {
    const result = await useCase.execute({ playerId: PLAYER_ID, trackingCode: CODE })

    expect(result.reason).toBe('attributed')
  })

  it('does not fail registration when attribution itself throws', async () => {
    const failing = new AttributePlayerUseCase(
      { findByTrackingCode: (): Promise<never> => Promise.reject(new Error('db down')) } as never,
      {
        findByPlayerId: (): Promise<null> => Promise.resolve(null),
        create: (): Promise<never> => Promise.reject(new Error('unused')),
      } as never,
      { findLastByAffiliate: (): Promise<null> => Promise.resolve(null) } as never,
      { hash: (ip: string): string => `hash-${ip}` } as never,
      { get: (): Promise<typeof settings> => Promise.resolve(settings) } as never,
    )

    const result = await failing.execute({ playerId: PLAYER_ID, trackingCode: CODE })

    expect(result).toEqual({ attributed: false, affiliateId: null, reason: 'error' })
  })
})
