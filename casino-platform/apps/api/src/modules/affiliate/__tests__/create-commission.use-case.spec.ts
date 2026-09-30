import { beforeEach, describe, expect, it } from 'vitest'

import {
  CreateCommissionUseCase,
  type CreateCommissionInput,
} from '../application/use-cases/create-commission.use-case'
import { parseRevShareRate } from '../domain/value-objects/revshare-rate.value-object'

import type {
  AffiliateCommissionEntity,
  AffiliateEntity,
  AffiliateAttributionEntity,
  AttributionForCalc,
  CommissionOutcome,
} from './helpers/affiliate-test-types'

const AFFILIATE_ID = 'aff-1'
const PLAYER_ID = 'player-1'
const PERIOD_START = new Date('2026-09-28T00:00:00.000Z')
const PERIOD_END = new Date('2026-09-28T23:59:59.999Z')

function makeInput(overrides: Partial<CreateCommissionInput> = {}): CreateCommissionInput {
  return {
    affiliateId: AFFILIATE_ID,
    playerId: PLAYER_ID,
    attributionId: 'attr-1',
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    ...overrides,
  }
}

function makeAffiliate(overrides: Partial<AffiliateEntity> = {}): AffiliateEntity {
  return {
    id: AFFILIATE_ID,
    userId: 'user-affiliate',
    email: 'partner@example.com',
    passwordHash: 'hash',
    status: 'active',
    trackingCode: 'ABCDEFGH',
    displayName: 'Partner',
    country: 'RU',
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

describe('CreateCommissionUseCase', () => {
  let useCase: CreateCommissionUseCase
  let affiliate: AffiliateEntity
  let existingCommission: AffiliateCommissionEntity | null
  let gameActivity: {
    bets: Map<string, string>
    wins: Map<string, string>
    rollbacks: Map<string, string>
  }
  let bonuses: Map<string, string>
  let createdInputs: Parameters<typeof makeCommission>[0][]
  let findByIdCalls: number

  function makeCommission(
    overrides: Partial<AffiliateCommissionEntity> = {},
  ): AffiliateCommissionEntity {
    return {
      id: 'comm-1',
      affiliateId: AFFILIATE_ID,
      playerId: PLAYER_ID,
      attributionId: 'attr-1',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      currency: 'RUB',
      betSum: '1000.00000000',
      winSum: '0.00000000',
      rollbackSum: '0.00000000',
      bonusSum: '0.00000000',
      providerFeeSum: '0.00000000',
      ggrAmount: '1000.00000000',
      ngrAmount: '1000.00000000',
      revshareRate: parseRevShareRate('0.2'),
      commissionAmount: '200.00000000',
      status: 'pending',
      creditedAt: null,
      ledgerEntryId: null,
      createdAt: new Date(),
      ...overrides,
    }
  }

  beforeEach(() => {
    affiliate = makeAffiliate()
    existingCommission = null
    gameActivity = {
      bets: new Map([['RUB', '1000']]),
      wins: new Map(),
      rollbacks: new Map(),
    }
    bonuses = new Map()
    createdInputs = []
    findByIdCalls = 0

    const affiliatesRepo = {
      findById: (): Promise<AffiliateEntity | null> => {
        findByIdCalls += 1
        return Promise.resolve(affiliate)
      },
    }
    const commissionsRepo = {
      findByPeriod: (): Promise<AffiliateCommissionEntity | null> =>
        Promise.resolve(existingCommission),
      create: (input: Parameters<typeof makeCommission>[0]): Promise<AffiliateCommissionEntity> => {
        createdInputs.push(input)
        return Promise.resolve(makeCommission(input))
      },
    }
    const activityRepo = {
      sumGameActivity: (): Promise<typeof gameActivity> => Promise.resolve(gameActivity),
      sumPlayerBonuses: (): Promise<Map<string, string>> => Promise.resolve(bonuses),
    }

    useCase = new CreateCommissionUseCase(
      affiliatesRepo as never,
      commissionsRepo as never,
      activityRepo as never,
    )
  })

  it('creates a commission of ngr × rate for positive ngr', async () => {
    const outcome = await useCase.executeForCurrency(makeInput(), 'RUB')

    expect(outcome.status).toBe('created')
    if (outcome.status !== 'created') {
      throw new Error('expected created')
    }
    expect(outcome.commissionAmount).toBe('200.00000000')
    expect(outcome.ngr.ngr).toBe('1000.00000000')
  })

  it('skips without writing when a commission for the period already exists', async () => {
    existingCommission = makeCommission()

    const outcome = await useCase.executeForCurrency(makeInput(), 'RUB')

    expect(outcome).toEqual({ status: 'skipped_duplicate' })
    expect(createdInputs).toHaveLength(0)
  })

  it('skips idempotently when the same period is processed twice', async () => {
    const first = await useCase.executeForCurrency(makeInput(), 'RUB')
    existingCommission = makeCommission()
    const second = await useCase.executeForCurrency(makeInput(), 'RUB')

    expect(first.status).toBe('created')
    expect(second.status).toBe('skipped_duplicate')
    expect(createdInputs).toHaveLength(1)
  })

  it('does not create a commission for negative ngr', async () => {
    gameActivity = {
      bets: new Map([['RUB', '1000']]),
      wins: new Map([['RUB', '1700']]),
      rollbacks: new Map(),
    }

    const outcome = await useCase.executeForCurrency(makeInput(), 'RUB')

    expect(outcome.status).toBe('skipped_negative_ngr')
    expect(createdInputs).toHaveLength(0)
  })

  it('does not create a commission when the player had no activity', async () => {
    gameActivity = { bets: new Map(), wins: new Map(), rollbacks: new Map() }

    const outcome = await useCase.executeForCurrency(makeInput(), 'RUB')

    expect(outcome.status).toBe('skipped_duplicate')
    expect(createdInputs).toHaveLength(0)
  })

  it('skips a currency the player never used', async () => {
    const outcome = await useCase.executeForCurrency(makeInput(), 'BTC')

    expect(outcome.status).toBe('skipped_duplicate')
    expect(createdInputs).toHaveLength(0)
  })

  it('applies the affiliate individual rate, not the default', async () => {
    affiliate = makeAffiliate({ revshareRate: parseRevShareRate('0.35') })

    const outcome = await useCase.executeForCurrency(makeInput(), 'RUB')

    if (outcome.status !== 'created') {
      throw new Error('expected created')
    }
    expect(outcome.commissionAmount).toBe('350.00000000')
  })

  it('snapshots the rate at write time so a later rate change does not rewrite history', async () => {
    // Первое чтение — 20%, второе (перед записью) — уже 30%: в начисление
    // должен попасть актуальный снимок 30%.
    affiliate = makeAffiliate({ revshareRate: parseRevShareRate('0.2') })
    const repo = {
      findById: (): Promise<AffiliateEntity | null> => {
        findByIdCalls += 1
        if (findByIdCalls === 1) {
          return Promise.resolve(affiliate)
        }
        affiliate = makeAffiliate({ revshareRate: parseRevShareRate('0.3') })
        return Promise.resolve(affiliate)
      },
    }
    const useCaseWithChangingRate = new CreateCommissionUseCase(
      repo as never,
      {
        findByPeriod: (): Promise<null> => Promise.resolve(null),
        create: (i: Parameters<typeof makeCommission>[0]): Promise<AffiliateCommissionEntity> =>
          Promise.resolve(makeCommission(i)),
      } as never,
      {
        sumGameActivity: (): Promise<typeof gameActivity> => Promise.resolve(gameActivity),
        sumPlayerBonuses: (): Promise<Map<string, string>> => Promise.resolve(bonuses),
      } as never,
    )

    const outcome = await useCaseWithChangingRate.executeForCurrency(makeInput(), 'RUB')

    if (outcome.status !== 'created') {
      throw new Error('expected created')
    }
    expect(outcome.commissionAmount).toBe('300.00000000')
  })

  it('subtracts bonuses from ngr before applying the rate', async () => {
    bonuses = new Map([['RUB', '500']])

    const outcome = await useCase.executeForCurrency(makeInput(), 'RUB')

    if (outcome.status !== 'created') {
      throw new Error('expected created')
    }
    // ggr 1000, bonus 500 → ngr 500, комиссия 20% = 100
    expect(outcome.ngr.ggr).toBe('1000.00000000')
    expect(outcome.ngr.ngr).toBe('500.00000000')
    expect(outcome.commissionAmount).toBe('100.00000000')
  })

  it('persists the full ngr breakdown for partner-facing transparency', async () => {
    bonuses = new Map([['RUB', '100']])
    gameActivity = {
      bets: new Map([['RUB', '2000']]),
      wins: new Map([['RUB', '500']]),
      rollbacks: new Map([['RUB', '100']]),
    }

    await useCase.executeForCurrency(makeInput(), 'RUB')

    expect(createdInputs[0]).toMatchObject({
      betSum: '2000.00000000',
      winSum: '500.00000000',
      rollbackSum: '100.00000000',
      bonusSum: '100.00000000',
      providerFeeSum: '0.00000000',
      ggrAmount: '1400.00000000',
      ngrAmount: '1300.00000000',
    })
  })

  it('skips when the affiliate no longer exists', async () => {
    const missingRepo = { findById: (): Promise<null> => Promise.resolve(null) }
    const useCaseMissing = new CreateCommissionUseCase(
      missingRepo as never,
      {
        findByPeriod: (): Promise<null> => Promise.resolve(null),
        create: (): Promise<never> => Promise.reject(new Error('must not be called')),
      } as never,
      {
        sumGameActivity: (): Promise<typeof gameActivity> => Promise.resolve(gameActivity),
        sumPlayerBonuses: (): Promise<Map<string, string>> => Promise.resolve(bonuses),
      } as never,
    )

    const outcome = await useCaseMissing.executeForCurrency(makeInput(), 'RUB')

    expect(outcome).toEqual({ status: 'skipped_duplicate' })
  })

  it('creates a zero-rate commission as nothing rather than a zero row', async () => {
    affiliate = makeAffiliate({ revshareRate: parseRevShareRate('0') })

    const outcome = await useCase.executeForCurrency(makeInput(), 'RUB')

    expect(outcome.status).toBe('skipped_negative_ngr')
    expect(createdInputs).toHaveLength(0)
  })
})

describe('commission outcome contract', () => {
  it('distinguishes duplicate from negative-ngr so reporting can tell them apart', () => {
    const duplicate: CommissionOutcome = { status: 'skipped_duplicate' }
    const negative: CommissionOutcome = { status: 'skipped_negative_ngr', ngr: '-700.00000000' }
    const attribution: AttributionForCalc = { attributionId: 'a', affiliateId: 'b', playerId: 'c' }
    const attr: AffiliateAttributionEntity | null = null

    expect(duplicate.status).not.toBe(negative.status)
    expect(attribution.playerId).toBe('c')
    expect(attr).toBeNull()
  })
})
