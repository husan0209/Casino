import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AFFILIATE_SETTINGS_DEFAULTS,
  type AffiliateSettings,
} from '../../domain/affiliate-settings'
import {
  type AffiliateAttributionRepository,
  type AffiliatePlayerProvisioningRepository,
} from '../../domain/repositories/affiliate.repository'
import { type AffiliateSettingsService } from '../affiliate-settings.service'
import { QualifyAttributionsUseCase } from './qualify-attributions.use-case'

import type { AffiliateAttributionEntity } from '../../__tests__/helpers/affiliate-test-types'

const PAGE_SIZE = 200

function makeAttribution(
  overrides: Partial<AffiliateAttributionEntity> = {},
): AffiliateAttributionEntity {
  return {
    id: 'attr-1',
    affiliateId: 'aff-1',
    playerId: 'player-1',
    clickId: null,
    status: 'pending',
    qualifiedAt: null,
    firstDepositId: 'dep-1',
    firstDepositAt: new Date('2026-01-01T00:00:00.000Z'),
    totalDeposit: '1000.00000000',
    depositCount: 1,
    isSelfReferral: false,
    rejectReason: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

function makeDeps(
  options: {
    pages?: AffiliateAttributionEntity[][]
    settings?: Partial<AffiliateSettings>
    kycApproved?: boolean
    findById?: (id: string) => Promise<AffiliateAttributionEntity | null>
    qualify?: (input: unknown) => Promise<AffiliateAttributionEntity>
  } = {},
): {
  attributions: AffiliateAttributionRepository
  players: AffiliatePlayerProvisioningRepository
  settings: AffiliateSettingsService
  list: ReturnType<typeof vi.fn>
  findById: ReturnType<typeof vi.fn>
  qualify: ReturnType<typeof vi.fn>
  isKycApproved: ReturnType<typeof vi.fn>
} {
  const pages = options.pages ?? [[]]
  const list = vi.fn(async (args: { page: number }) => {
    const page = pages[args.page - 1] ?? []
    return { items: page, total: pages.flat().length }
  })
  // По умолчанию findById отдаёт именно ту атрибуцию, что была в списке: если
  // подставить вместо неё заготовку с дефолтной суммой, тесты на порог и на
  // firstDepositAt проходили бы враньё.
  const byId = new Map(pages.flat().map((attribution) => [attribution.id, attribution]))
  const findById = vi.fn(async (id: string): Promise<AffiliateAttributionEntity | null> =>
    options.findById === undefined ? (byId.get(id) ?? null) : options.findById(id),
  )
  const qualify = vi.fn(async (input: unknown): Promise<AffiliateAttributionEntity> => {
    if (options.qualify) {
      return options.qualify(input)
    }
    return makeAttribution()
  })
  const isKycApproved = vi.fn(
    async (_playerId: string): Promise<boolean> => options.kycApproved ?? true,
  )

  return {
    attributions: { list, findById, qualify } as unknown as AffiliateAttributionRepository,
    players: { isKycApproved } as unknown as AffiliatePlayerProvisioningRepository,
    settings: {
      get: async () => ({
        ...AFFILIATE_SETTINGS_DEFAULTS,
        minDepositRub: 500,
        ...options.settings,
      }),
    } as unknown as AffiliateSettingsService,
    list,
    findById,
    qualify,
    isKycApproved,
  }
}

function makeUseCase(deps: ReturnType<typeof makeDeps>): QualifyAttributionsUseCase {
  return new QualifyAttributionsUseCase(deps.attributions, deps.players, deps.settings)
}

describe('QualifyAttributionsUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports zeroes and writes nothing when there is no pending attribution', async () => {
    const deps = makeDeps({ pages: [[]] })

    const result = await makeUseCase(deps).execute()

    expect(result).toEqual({ checked: 0, qualified: 0, stillPending: 0, errors: [] })
    expect(deps.qualify).not.toHaveBeenCalled()
  })

  it('only asks the repository for pending attributions, page by page', async () => {
    const deps = makeDeps({ pages: [[]] })

    await makeUseCase(deps).execute()

    expect(deps.list).toHaveBeenCalledWith({ status: 'pending', page: 1, perPage: PAGE_SIZE })
  })

  it('qualifies an attribution that meets every condition', async () => {
    const deps = makeDeps({ pages: [[makeAttribution()]] })

    const result = await makeUseCase(deps).execute()

    expect(result).toEqual({ checked: 1, qualified: 1, stillPending: 0, errors: [] })
    expect(deps.qualify).toHaveBeenCalledTimes(1)
  })

  it('passes the deposit evidence through to the repository', async () => {
    const attribution = makeAttribution({
      totalDeposit: '2500.50000000',
      depositCount: 4,
    })
    const deps = makeDeps({ pages: [[attribution]] })

    await makeUseCase(deps).execute()

    expect(deps.qualify).toHaveBeenCalledWith({
      id: 'attr-1',
      firstDepositId: 'dep-1',
      firstDepositAt: attribution.firstDepositAt,
      totalDeposit: '2500.50000000',
      depositCount: 4,
    })
  })

  it('treats a deposit exactly at the threshold as qualifying', async () => {
    const deps = makeDeps({ pages: [[makeAttribution({ totalDeposit: '500' })]] })

    const result = await makeUseCase(deps).execute()

    expect(result.qualified).toBe(1)
    expect(result.stillPending).toBe(0)
  })

  it('keeps an attribution pending while the deposit is below the threshold', async () => {
    const deps = makeDeps({ pages: [[makeAttribution({ totalDeposit: '499.99' })]] })

    const result = await makeUseCase(deps).execute()

    expect(result).toEqual({ checked: 1, qualified: 0, stillPending: 1, errors: [] })
    expect(deps.qualify).not.toHaveBeenCalled()
  })

  it('never qualifies an attribution without a first deposit', async () => {
    const deps = makeDeps({
      pages: [
        [makeAttribution({ totalDeposit: '9999', firstDepositAt: null, firstDepositId: null })],
      ],
    })

    const result = await makeUseCase(deps).execute()

    expect(result.stillPending).toBe(1)
    expect(deps.qualify).not.toHaveBeenCalled()
  })

  it('waits for KYC when the program requires it', async () => {
    const deps = makeDeps({ pages: [[makeAttribution()]], kycApproved: false })

    const result = await makeUseCase(deps).execute()

    expect(result.stillPending).toBe(1)
    expect(deps.isKycApproved).toHaveBeenCalledWith('player-1')
    expect(deps.qualify).not.toHaveBeenCalled()
  })

  it('qualifies without KYC when the program does not require it', async () => {
    const deps = makeDeps({
      pages: [[makeAttribution()]],
      kycApproved: false,
      settings: { requireKyc: false },
    })

    const result = await makeUseCase(deps).execute()

    expect(result.qualified).toBe(1)
    expect(deps.isKycApproved).not.toHaveBeenCalled()
  })

  it('ignores an attribution whose status changed away from pending', async () => {
    const deps = makeDeps({
      pages: [[makeAttribution()]],
      findById: () => Promise.resolve(makeAttribution({ status: 'qualified' })),
    })

    const result = await makeUseCase(deps).execute()

    expect(result.stillPending).toBe(1)
    expect(deps.qualify).not.toHaveBeenCalled()
  })

  it('ignores an attribution that disappeared between listing and reading', async () => {
    const deps = makeDeps({ pages: [[makeAttribution()]], findById: () => Promise.resolve(null) })

    const result = await makeUseCase(deps).execute()

    expect(result).toEqual({ checked: 1, qualified: 0, stillPending: 1, errors: [] })
    expect(deps.qualify).not.toHaveBeenCalled()
  })

  it('collects a failure per attribution and keeps processing the rest', async () => {
    const deps = makeDeps({
      pages: [[makeAttribution({ id: 'attr-bad' }), makeAttribution({ id: 'attr-good' })]],
      qualify: (input) => {
        const payload = input as { id: string }
        if (payload.id === 'attr-bad') {
          return Promise.reject(new Error('write conflict'))
        }
        return Promise.resolve(makeAttribution())
      },
    })

    const result = await makeUseCase(deps).execute()

    expect(result.checked).toBe(2)
    expect(result.qualified).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('attr-bad')
  })

  it('keeps paging while a full page comes back', async () => {
    const full = Array.from({ length: PAGE_SIZE }, (_unused, index) =>
      makeAttribution({ id: `attr-${index}` }),
    )
    const deps = makeDeps({ pages: [full, [makeAttribution({ id: 'attr-last' })]] })

    const result = await makeUseCase(deps).execute()

    expect(deps.list).toHaveBeenCalledTimes(2)
    expect(result.checked).toBe(PAGE_SIZE + 1)
  })

  it('stops after a short page instead of asking for an empty one', async () => {
    const deps = makeDeps({ pages: [[makeAttribution()]] })

    await makeUseCase(deps).execute()

    expect(deps.list).toHaveBeenCalledTimes(1)
  })
})
