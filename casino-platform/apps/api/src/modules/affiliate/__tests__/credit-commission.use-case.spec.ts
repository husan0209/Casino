import { beforeEach, describe, expect, it } from 'vitest'

import { CreditCommissionUseCase } from '../application/use-cases/credit-commission.use-case'
import { sanitizePath } from '../application/use-cases/track-click.use-case'
import { parseRevShareRate } from '../domain/value-objects/revshare-rate.value-object'

import type { AffiliateCommissionEntity, AffiliateEntity } from './helpers/affiliate-test-types'

const AFFILIATE_ID = 'aff-1'
const AFFILIATE_USER_ID = 'user-affiliate'
const PLAYER_ID = 'player-1'

function makeAffiliate(): AffiliateEntity {
  return {
    id: AFFILIATE_ID,
    userId: AFFILIATE_USER_ID,
    email: 'partner@example.com',
    passwordHash: 'hash',
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
  }
}

function makeCommission(
  overrides: Partial<AffiliateCommissionEntity> = {},
): AffiliateCommissionEntity {
  return {
    id: 'comm-1',
    affiliateId: AFFILIATE_ID,
    playerId: PLAYER_ID,
    attributionId: 'attr-1',
    periodStart: new Date('2026-09-20T00:00:00.000Z'),
    periodEnd: new Date('2026-09-20T00:00:00.000Z'),
    currency: 'RUB',
    betSum: '1000',
    winSum: '0',
    rollbackSum: '0',
    bonusSum: '0',
    providerFeeSum: '0',
    ggrAmount: '1000',
    ngrAmount: '1000',
    revshareRate: parseRevShareRate('0.2'),
    commissionAmount: '200.00000000',
    status: 'pending',
    creditedAt: null,
    ledgerEntryId: null,
    createdAt: new Date(),
    ...overrides,
  }
}

describe('CreditCommissionUseCase', () => {
  let useCase: CreditCommissionUseCase
  let commission: AffiliateCommissionEntity | null
  let credits: Array<{ userId: string; amount: string; idempotencyKey: string; type: string }>
  let markedCredited: string[]
  let earnedDeltas: string[]

  beforeEach(() => {
    commission = makeCommission()
    credits = []
    markedCredited = []
    earnedDeltas = []

    const affiliatesRepo = {
      findById: (): Promise<AffiliateEntity> => Promise.resolve(makeAffiliate()),
      addEarned: (_id: string, amount: string): Promise<void> => {
        earnedDeltas.push(amount)
        return Promise.resolve()
      },
    }
    const commissionsRepo = {
      findById: (): Promise<AffiliateCommissionEntity | null> => Promise.resolve(commission),
      markCredited: (id: string): Promise<void> => {
        markedCredited.push(id)
        return Promise.resolve()
      },
    }
    const walletFacade = {
      credit: (input: {
        userId: string
        amount: string
        idempotencyKey: string
        type: string
      }): Promise<{ ledgerEntryId: string; duplicate: boolean }> => {
        credits.push({
          userId: input.userId,
          amount: input.amount,
          idempotencyKey: input.idempotencyKey,
          type: input.type,
        })
        return Promise.resolve({ ledgerEntryId: 'led-1', duplicate: false })
      },
    }

    useCase = new CreditCommissionUseCase(
      affiliatesRepo as never,
      commissionsRepo as never,
      walletFacade as never,
    )
  })

  it('credits the affiliate wallet, never the player wallet', async () => {
    await useCase.execute({ commissionId: 'comm-1' })

    expect(credits).toHaveLength(1)
    expect(credits[0]?.userId).toBe(AFFILIATE_USER_ID)
    expect(credits[0]?.userId).not.toBe(PLAYER_ID)
  })

  it('uses a deterministic idempotency key per commission', async () => {
    await useCase.execute({ commissionId: 'comm-1' })

    expect(credits[0]?.idempotencyKey).toBe('aff_comm-1')
  })

  it('uses CONVERSION_CREDIT as the ledger type', async () => {
    await useCase.execute({ commissionId: 'comm-1' })

    expect(credits[0]?.type).toBe('CONVERSION_CREDIT')
  })

  it('marks the commission credited and updates total_earned', async () => {
    const result = await useCase.execute({ commissionId: 'comm-1' })

    expect(result).toEqual({ status: 'credited', ledgerEntryId: 'led-1', amount: '200.00000000' })
    expect(markedCredited).toEqual(['comm-1'])
    expect(earnedDeltas).toEqual(['200.00000000'])
  })

  it('skips an already credited commission without a second credit', async () => {
    commission = makeCommission({ status: 'approved', creditedAt: new Date() })

    const result = await useCase.execute({ commissionId: 'comm-1' })

    expect(result).toEqual({ status: 'skipped', reason: 'already_credited' })
    expect(credits).toHaveLength(0)
    expect(earnedDeltas).toHaveLength(0)
  })

  it('skips a cancelled commission', async () => {
    commission = makeCommission({ status: 'cancelled' })

    const result = await useCase.execute({ commissionId: 'comm-1' })

    expect(result).toEqual({ status: 'skipped', reason: 'already_cancelled' })
    expect(credits).toHaveLength(0)
  })

  it('skips a missing commission', async () => {
    commission = null

    const result = await useCase.execute({ commissionId: 'missing' })

    expect(result).toEqual({ status: 'skipped', reason: 'not_found' })
  })

  it('never credits a zero amount', async () => {
    commission = makeCommission({ commissionAmount: '0.00000000' })

    await useCase.execute({ commissionId: 'comm-1' })

    expect(credits[0]?.amount).toBe('0.00000000')
  })

  it('does not throw when the wallet fails — batch must continue', async () => {
    const failing = new CreditCommissionUseCase(
      {
        findById: (): Promise<AffiliateEntity> => Promise.resolve(makeAffiliate()),
        addEarned: (): Promise<void> => Promise.resolve(),
      } as never,
      {
        findById: (): Promise<AffiliateCommissionEntity> =>
          Promise.resolve(commission as AffiliateCommissionEntity),
        markCredited: (): Promise<void> => Promise.resolve(),
      } as never,
      { credit: (): Promise<never> => Promise.reject(new Error('wallet down')) } as never,
    )

    const result = await failing.executeSafe({ commissionId: 'comm-1' })

    expect(result.status).toBe('skipped')
  })
})

describe('deep-link sanitisation (regression guard)', () => {
  it('never produces an off-site redirect', () => {
    const hostile = [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      'http://localhost:3000/casino',
    ]
    for (const value of hostile) {
      const result = sanitizePath(value)
      expect(result.startsWith('/casino')).toBe(true)
    }
  })
})
