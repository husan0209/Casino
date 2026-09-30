import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resolvePeriod, AffiliateDailyRunUseCase } from './affiliate-daily-run.use-case'
import { type CreateCommissionUseCase } from './create-commission.use-case'
import { type CreditCommissionUseCase } from './credit-commission.use-case'
import {
  type AffiliateAttributionRepository,
  type AttributionForCalc,
  type GameActivityRepository,
  type GameTotalsByCurrency,
} from '../../domain/repositories/affiliate.repository'
import { type NgrResult } from '../../domain/value-objects/ngr-calculator'

const PAGE_SIZE = 200

type CommissionOutcome =
  | { status: 'skipped_duplicate' }
  | { status: 'skipped_negative_ngr'; ngr: string }
  | { status: 'created'; commissionId: string; ngr: NgrResult; commissionAmount: string }

function makeNgr(amount: string): NgrResult {
  return {
    ggr: '0',
    ngr: amount,
    ngrBreakdown: {
      betSum: '0',
      winSum: '0',
      rollbackSum: '0',
      bonusSum: '0',
      providerFeeSum: '0',
    },
    isPositive: true,
  }
}

function makeItem(overrides: Partial<AttributionForCalc> = {}): AttributionForCalc {
  return {
    attributionId: 'attr-1',
    affiliateId: 'aff-1',
    playerId: 'player-1',
    ...overrides,
  }
}

function emptyTotals(): GameTotalsByCurrency {
  return { bets: new Map(), wins: new Map(), rollbacks: new Map() }
}

function makeDeps(
  options: {
    pages?: AttributionForCalc[][]
    totals?: GameTotalsByCurrency
    sumGameActivity?: (args: { playerId: string }) => Promise<GameTotalsByCurrency>
    createOutcome?: (
      affiliateId: string,
      playerId: string,
      currency: string,
    ) => CommissionOutcome | Promise<CommissionOutcome>
  } = {},
): {
  attributions: AffiliateAttributionRepository
  listQualifiedForCalc: ReturnType<typeof vi.fn>
  activity: GameActivityRepository
  createCommission: CreateCommissionUseCase
  creditCommission: CreditCommissionUseCase
  executeForCurrency: ReturnType<typeof vi.fn>
  executeSafe: ReturnType<typeof vi.fn>
  sumGameActivity: ReturnType<typeof vi.fn>
} {
  const pages = options.pages ?? [[]]
  const listQualifiedForCalc = vi.fn(async (args: { page: number }) => {
    const page = pages[args.page - 1] ?? []
    return { items: page, total: pages.flat().length }
  })
  const sumGameActivity = vi.fn(
    async (args: { playerId: string }): Promise<GameTotalsByCurrency> =>
      options.sumGameActivity === undefined
        ? (options.totals ?? emptyTotals())
        : options.sumGameActivity(args),
  )
  const executeForCurrency = vi.fn(
    async (
      input: { affiliateId: string; playerId: string },
      currency: string,
    ): Promise<CommissionOutcome> => {
      if (options.createOutcome) {
        return options.createOutcome(input.affiliateId, input.playerId, currency)
      }
      return {
        status: 'created',
        commissionId: `comm-${currency}`,
        ngr: makeNgr('10'),
        commissionAmount: '10',
      }
    },
  )
  const executeSafe = vi.fn(async (_args: { commissionId: string }) => ({ status: 'credited' }))

  return {
    attributions: { listQualifiedForCalc } as unknown as AffiliateAttributionRepository,
    listQualifiedForCalc,
    activity: { sumGameActivity } as unknown as GameActivityRepository,
    createCommission: { executeForCurrency } as unknown as CreateCommissionUseCase,
    creditCommission: { executeSafe } as unknown as CreditCommissionUseCase,
    executeForCurrency,
    executeSafe,
    sumGameActivity,
  }
}

function makeUseCase(deps: ReturnType<typeof makeDeps>): AffiliateDailyRunUseCase {
  return new AffiliateDailyRunUseCase(
    deps.attributions,
    deps.activity,
    deps.createCommission,
    deps.creditCommission,
  )
}

const oneRuble = { bets: new Map([['RUB', '100']]), wins: new Map(), rollbacks: new Map() }

describe('resolvePeriod', () => {
  it('spans one UTC calendar day', () => {
    const period = resolvePeriod('2026-03-15T13:37:00.000Z')

    expect(period.periodStart.toISOString()).toBe('2026-03-15T00:00:00.000Z')
    expect(period.periodEnd.toISOString()).toBe('2026-03-15T23:59:59.999Z')
  })

  it('defaults to yesterday when no date is given', () => {
    const period = resolvePeriod()

    expect(period.periodStart.getTime()).toBeLessThanOrEqual(Date.now())
    expect(period.periodStart.getUTCHours()).toBe(0)
    expect(period.periodEnd.getUTCDate()).toBe(period.periodStart.getUTCDate())
  })
})

describe('AffiliateDailyRunUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does nothing and reports zeroes when there is nothing to calculate', async () => {
    const deps = makeDeps({ pages: [[]] })

    const result = await makeUseCase(deps).execute('2026-03-15')

    expect(result).toEqual({
      date: '2026-03-15',
      processed: 0,
      created: 0,
      credited: 0,
      skippedDuplicates: 0,
      skippedNegativeNgr: 0,
      errors: [],
    })
    expect(deps.executeForCurrency).not.toHaveBeenCalled()
  })

  it('walks only qualified attributions up to the period end', async () => {
    const deps = makeDeps({ pages: [[]] })

    await makeUseCase(deps).execute('2026-03-15')

    expect(deps.listQualifiedForCalc).toHaveBeenCalledWith({
      until: new Date('2026-03-15T23:59:59.999Z'),
      page: 1,
      perPage: PAGE_SIZE,
    })
  })

  it('creates and credits one commission per currency with activity', async () => {
    const deps = makeDeps({ pages: [[makeItem()]], totals: oneRuble })

    const result = await makeUseCase(deps).execute('2026-03-15')

    expect(result.processed).toBe(1)
    expect(result.created).toBe(1)
    expect(result.credited).toBe(1)
    expect(deps.executeForCurrency).toHaveBeenCalledWith(
      expect.objectContaining({
        affiliateId: 'aff-1',
        playerId: 'player-1',
        attributionId: 'attr-1',
      }),
      'RUB',
    )
    expect(deps.executeSafe).toHaveBeenCalledWith({ commissionId: 'comm-RUB' })
  })

  it('covers a currency that appears only in wins or only in rollbacks', async () => {
    const totals: GameTotalsByCurrency = {
      bets: new Map(),
      wins: new Map([['RUB', '5']]),
      rollbacks: new Map([['USD', '1']]),
    }
    const deps = makeDeps({ pages: [[makeItem()]], totals })

    const result = await makeUseCase(deps).execute('2026-03-15')

    expect(result.created).toBe(2)
    // String(...) явно: аргументы у нетипизированного vi.fn — any, и возврат
    // такого значения ловит no-unsafe-return.
    const currencies = deps.executeForCurrency.mock.calls.map((call) => String(call[1])).sort()
    expect(currencies).toEqual(['RUB', 'USD'])
  })

  it('counts a pre-existing commission as a duplicate, not as an error', async () => {
    const deps = makeDeps({
      pages: [[makeItem()]],
      totals: oneRuble,
      createOutcome: () => ({ status: 'skipped_duplicate' }),
    })

    const result = await makeUseCase(deps).execute('2026-03-15')

    expect(result.skippedDuplicates).toBe(1)
    expect(result.skippedNegativeNgr).toBe(0)
    expect(result.created).toBe(0)
    expect(result.errors).toEqual([])
    expect(deps.executeSafe).not.toHaveBeenCalled()
  })

  it('tracks a non-positive NGR separately from a duplicate', async () => {
    const deps = makeDeps({
      pages: [[makeItem()]],
      totals: oneRuble,
      createOutcome: () => ({ status: 'skipped_negative_ngr', ngr: '0' }),
    })

    const result = await makeUseCase(deps).execute('2026-03-15')

    expect(result.skippedNegativeNgr).toBe(1)
    expect(result.skippedDuplicates).toBe(0)
  })

  it('does not count a commission as credited when crediting fails', async () => {
    const deps = makeDeps({ pages: [[makeItem()]], totals: oneRuble })
    deps.executeSafe.mockResolvedValue({ status: 'skipped' })

    const result = await makeUseCase(deps).execute('2026-03-15')

    expect(result.created).toBe(1)
    expect(result.credited).toBe(0)
  })

  it('records an activity failure and moves on to the next attribution', async () => {
    const deps = makeDeps({
      pages: [[makeItem({ playerId: 'bad-player' }), makeItem({ playerId: 'good-player' })]],
      sumGameActivity: ({ playerId }) =>
        playerId === 'bad-player'
          ? Promise.reject(new Error('db down'))
          : Promise.resolve(oneRuble),
    })

    const result = await makeUseCase(deps).execute('2026-03-15')

    expect(result.processed).toBe(2)
    expect(result.created).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('bad-player')
  })

  it('keeps a per-currency failure from killing the rest of the run', async () => {
    const deps = makeDeps({
      pages: [[makeItem()]],
      totals: {
        bets: new Map([['RUB', '1']]),
        wins: new Map([['USD', '1']]),
        rollbacks: new Map(),
      },
      createOutcome: (_affiliateId, _playerId, currency) => {
        if (currency === 'RUB') {
          return Promise.reject(new Error('write conflict'))
        }
        return {
          status: 'created',
          commissionId: 'comm-usd',
          ngr: makeNgr('1'),
          commissionAmount: '1',
        }
      },
    })

    const result = await makeUseCase(deps).execute('2026-03-15')

    expect(result.created).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('RUB')
  })

  it('keeps paging while a full page comes back', async () => {
    const full = Array.from({ length: PAGE_SIZE }, (_unused, index) =>
      makeItem({ attributionId: `attr-${index}` }),
    )
    const deps = makeDeps({ pages: [full, [makeItem({ attributionId: 'attr-last' })]] })

    const result = await makeUseCase(deps).execute('2026-03-15')

    expect(deps.listQualifiedForCalc).toHaveBeenCalledTimes(2)
    expect(result.processed).toBe(PAGE_SIZE + 1)
  })

  it('stops after a short page instead of asking for an empty one', async () => {
    const deps = makeDeps({ pages: [[makeItem()]], totals: oneRuble })

    await makeUseCase(deps).execute('2026-03-15')

    expect(deps.listQualifiedForCalc).toHaveBeenCalledTimes(1)
  })
})
