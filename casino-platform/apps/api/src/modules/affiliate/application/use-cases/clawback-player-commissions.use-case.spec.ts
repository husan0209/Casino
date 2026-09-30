import { beforeEach, describe, expect, it } from 'vitest'

import { ClawbackPlayerCommissionsUseCase } from './clawback-player-commissions.use-case'
import { parseRevShareRate } from '../../domain/value-objects/revshare-rate.value-object'

import type {
  AffiliateAttributionEntity,
  AffiliateCommissionEntity,
  AffiliateEntity,
} from '../../__tests__/helpers/affiliate-test-types'

const PLAYER_ID = 'player-1'
const AFFILIATE_ID = 'aff-1'
const AFFILIATE_USER_ID = 'user-affiliate'

function makeAffiliate(overrides: Partial<AffiliateEntity> = {}): AffiliateEntity {
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
    totalEarned: '1000',
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

function makeAttribution(
  overrides: Partial<AffiliateAttributionEntity> = {},
): AffiliateAttributionEntity {
  return {
    id: 'attr-1',
    affiliateId: AFFILIATE_ID,
    playerId: PLAYER_ID,
    clickId: '10',
    status: 'qualified',
    qualifiedAt: new Date(),
    firstDepositId: 'pay-1',
    firstDepositAt: new Date(),
    totalDeposit: '500',
    depositCount: 1,
    isSelfReferral: false,
    rejectReason: null,
    createdAt: new Date(),
    ...overrides,
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
    status: 'approved',
    creditedAt: new Date(),
    ledgerEntryId: 'led-1',
    createdAt: new Date(),
    ...overrides,
  }
}

describe('ClawbackPlayerCommissionsUseCase', () => {
  let useCase: ClawbackPlayerCommissionsUseCase
  let attribution: AffiliateAttributionEntity | null
  let commissions: AffiliateCommissionEntity[]
  let debits: Array<{ userId: string; amount: string; idempotencyKey: string }>
  let debitsSucceed: boolean
  let cancelledIds: string[]
  let earnedDeltas: string[]
  let cancelledAttributionReason: string | null

  beforeEach(() => {
    attribution = makeAttribution()
    commissions = [makeCommission()]
    debits = []
    debitsSucceed = true
    cancelledIds = []
    earnedDeltas = []
    cancelledAttributionReason = null

    const affiliatesRepo = {
      findById: (): Promise<AffiliateEntity> => Promise.resolve(makeAffiliate()),
      addEarned: (_id: string, amount: string): Promise<void> => {
        earnedDeltas.push(amount)
        return Promise.resolve()
      },
    }
    const commissionsRepo = {
      listCreditableByPlayer: (): Promise<AffiliateCommissionEntity[]> =>
        Promise.resolve(commissions),
      markCancelled: (id: string): Promise<null> => {
        cancelledIds.push(id)
        return Promise.resolve(null)
      },
    }
    const attributionsRepo = {
      findByPlayerId: (): Promise<AffiliateAttributionEntity | null> =>
        Promise.resolve(attribution),
      cancelForCompliance: (_id: string, reason: string): Promise<null> => {
        cancelledAttributionReason = reason
        return Promise.resolve(null)
      },
    }
    const walletFacade = {
      debit: (input: {
        userId: string
        amount: string
        idempotencyKey: string
      }): Promise<unknown> => {
        if (!debitsSucceed) {
          return Promise.reject(new Error('INSUFFICIENT_FUNDS'))
        }
        debits.push({
          userId: input.userId,
          amount: input.amount,
          idempotencyKey: input.idempotencyKey,
        })
        return Promise.resolve({ duplicate: false })
      },
    }

    useCase = new ClawbackPlayerCommissionsUseCase(
      affiliatesRepo as never,
      commissionsRepo as never,
      attributionsRepo as never,
      walletFacade as never,
    )
  })

  it('does nothing when the player was never attributed to an affiliate', async () => {
    attribution = null

    const result = await useCase.execute({ playerId: PLAYER_ID })

    expect(result).toEqual({
      checked: false,
      cancelled: 0,
      reversedAmount: '0',
      insufficientFunds: [],
      errors: [],
    })
    expect(debits).toHaveLength(0)
  })

  it('debits the credited commission from the affiliate wallet', async () => {
    const result = await useCase.execute({ playerId: PLAYER_ID })

    expect(result.checked).toBe(true)
    expect(result.cancelled).toBe(1)
    expect(result.reversedAmount).toBe('200.00000000')
    expect(debits).toHaveLength(1)
    expect(debits[0]?.userId).toBe(AFFILIATE_USER_ID)
    expect(debits[0]?.amount).toBe('200.00000000')
    expect(cancelledIds).toEqual(['comm-1'])
  })

  it('uses a deterministic idempotency key per commission so retries do not double-debit', async () => {
    await useCase.execute({ playerId: PLAYER_ID })

    expect(debits[0]?.idempotencyKey).toBe('aff_clawback_comm-1')
  })

  it('debits the affiliate user, never the excluded player', async () => {
    await useCase.execute({ playerId: PLAYER_ID })

    expect(debits[0]?.userId).not.toBe(PLAYER_ID)
  })

  it('cancels the attribution with the self_exclusion reason', async () => {
    await useCase.execute({ playerId: PLAYER_ID })

    expect(cancelledAttributionReason).toBe('self_exclusion')
  })

  it('cancels a pending commission without any money movement', async () => {
    commissions = [makeCommission({ status: 'pending', creditedAt: null })]

    const result = await useCase.execute({ playerId: PLAYER_ID })

    expect(result.cancelled).toBe(1)
    expect(result.reversedAmount).toBe('0')
    expect(debits).toHaveLength(0)
    expect(cancelledIds).toEqual(['comm-1'])
  })

  it('reports unrecoverable debt when the affiliate already withdrew the money', async () => {
    debitsSucceed = false

    const result = await useCase.execute({ playerId: PLAYER_ID })

    expect(result.cancelled).toBe(1)
    expect(result.reversedAmount).toBe('0')
    expect(result.insufficientFunds).toEqual([
      { commissionId: 'comm-1', amount: '200.00000000', currency: 'RUB' },
    ])
  })

  it('does not reduce total_earned when the reversal could not be applied', async () => {
    debitsSucceed = false

    await useCase.execute({ playerId: PLAYER_ID })

    expect(earnedDeltas).toHaveLength(0)
  })

  it('reduces total_earned by the reversed amount on success', async () => {
    await useCase.execute({ playerId: PLAYER_ID })

    expect(earnedDeltas).toEqual(['-200.00000000'])
  })

  it('reverses every credited commission of the player', async () => {
    commissions = [
      makeCommission({ id: 'comm-1', commissionAmount: '100.00000000' }),
      makeCommission({ id: 'comm-2', commissionAmount: '250.50000000' }),
    ]

    const result = await useCase.execute({ playerId: PLAYER_ID })

    expect(result.cancelled).toBe(2)
    expect(result.reversedAmount).toBe('350.50000000')
    expect(debits.map((d) => d.idempotencyKey)).toEqual([
      'aff_clawback_comm-1',
      'aff_clawback_comm-2',
    ])
  })

  it('keeps going when one commission fails, recording the error', async () => {
    commissions = [makeCommission({ id: 'comm-1' }), makeCommission({ id: 'comm-2' })]
    const failing = new ClawbackPlayerCommissionsUseCase(
      {
        findById: (): Promise<AffiliateEntity> => Promise.resolve(makeAffiliate()),
        addEarned: (): Promise<void> => Promise.resolve(),
      } as never,
      {
        listCreditableByPlayer: (): Promise<AffiliateCommissionEntity[]> =>
          Promise.resolve(commissions),
        markCancelled: (): Promise<null> => {
          throw new Error('write conflict')
        },
      } as never,
      {
        findByPlayerId: (): Promise<AffiliateAttributionEntity> =>
          Promise.resolve(attribution as AffiliateAttributionEntity),
        cancelForCompliance: (): Promise<null> => Promise.resolve(null),
      } as never,
      { debit: (): Promise<unknown> => Promise.resolve({ duplicate: false }) } as never,
    )

    const result = await failing.execute({ playerId: PLAYER_ID })

    expect(result.errors).toHaveLength(2)
    expect(result.errors[0]).toContain('write conflict')
  })
})
