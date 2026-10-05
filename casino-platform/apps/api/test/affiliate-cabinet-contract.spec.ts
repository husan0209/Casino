import { describe, expect, it, vi } from 'vitest'

import { AffiliateController } from '../src/modules/affiliate/presentation/controllers/affiliate.controller'

/**
 * Контракт кабинета партнёра: presentation-ответы против того, что читает фронт
 * (`apps/web/src/types/affiliate.ts`).
 *
 * Почему отдельный слой тестов: use-case'ы партнёрки покрыты (расчёт NGR, рулон
 * комиссий, атрибуция, JWT), а формы ответов контроллера — нет. Кабинет при этом
 * собирается из шести ручных `return { ... }` без DTO-класса, так что переименование
 * поля или возврат числа вместо MoneyAmount ломает не бэкенд, а молча пустые цифры
 * в UI. Деньги — строки (API_CONVENTIONS §10.1), и это тоже проверяется здесь.
 */

const ACTOR = { affiliateId: 'aff-1', email: 'partner@example.com' }

const AFFILIATE = {
  id: 'aff-1',
  userId: 'u-aff-1',
  email: 'partner@example.com',
  displayName: 'Партнёр Тестов',
  status: 'active',
  trackingCode: 'SPIN777',
  revshareRate: '0.3000',
  payoutCurrency: 'RUB',
  totalEarned: '18420.55',
  isAgreed: true,
}

const COMMISSION_ROW = {
  id: 'cm-1',
  periodStart: new Date('2026-09-01T00:00:00.000Z'),
  periodEnd: new Date('2026-09-30T00:00:00.000Z'),
  currency: 'RUB',
  betSum: '180000.00',
  winSum: '101070.00',
  rollbackSum: '0.00',
  bonusSum: '600.00',
  providerFeeSum: '0.00',
  ggrAmount: '78930.00',
  ngrAmount: '61402.10',
  revshareRate: '0.3000',
  commissionAmount: '18420.55',
  status: 'credited',
  creditedAt: new Date('2026-10-01T03:00:00.000Z'),
}

/** Набор полей, который контроллер читает у атрибуции для `/players`. */
const PLAYER_ROW: {
  playerId: string
  status: string
  totalDeposit: string
  depositCount: number
  firstDepositAt: Date
  rejectReason: string | null
  createdAt: Date
} = {
  playerId: 'p-1',
  status: 'qualified',
  totalDeposit: '25000.00',
  depositCount: 6,
  firstDepositAt: new Date('2026-09-12T10:04:00.000Z'),
  rejectReason: null,
  createdAt: new Date('2026-09-10T08:00:00.000Z'),
}

interface Fakes {
  balances?: Array<{ currency: string; balance: string }>
  clickStats?: { total: number; converted: number }
  totals?: { totalCommission: string; totalNgr: string; totalGgr: string }
  commissionsTotal?: number
  playersTotal?: number
  /** Строки `/players`; по умолчанию — одна квалифицированная без флага. */
  playerRows?: Array<typeof PLAYER_ROW>
}

interface RepoArgs {
  affiliateId: string
  page: number
  perPage: number
}

function makeController(fakes: Fakes = {}) {
  const balances = fakes.balances ?? [
    { currency: 'RUB', balance: '12420.55' },
    { currency: 'USDT_TRC20', balance: '96.40' },
  ]
  const findById = vi.fn(async (_id: string) => AFFILIATE)
  const listCommissions = vi.fn(async (_args: RepoArgs) => ({
    items: [COMMISSION_ROW],
    total: fakes.commissionsTotal ?? 1,
  }))
  const totals = vi.fn(
    async () =>
      fakes.totals ?? { totalCommission: '18420.55', totalNgr: '61402.10', totalGgr: '78930.00' },
  )
  const listAttributions = vi.fn(async (args: RepoArgs) => ({
    items: args.perPage === 1 ? [] : (fakes.playerRows ?? [PLAYER_ROW]),
    total: args.perPage === 1 ? (fakes.playersTotal ?? 47) : (fakes.playersTotal ?? 2),
  }))
  const clickStats = vi.fn(async () => fakes.clickStats ?? { total: 1284, converted: 47 })
  const getSettings = vi.fn(async () => ({ cookieDays: 30, termsVersion: '2026-09' }))
  const getBalances = vi.fn(async () => balances)
  // В3: записи кабинета ушли в application-слой, контроллер только сериализует
  // ответ — поэтому мокаются именно сценарии, а не репозиторий.
  const updateProfile = vi.fn(async () => ({
    ...AFFILIATE,
    displayName: 'Новое имя',
    telegram: '@partner',
    website: 'https://partner.example',
  }))
  const leaveProgram = vi.fn(async () => ({ ...AFFILIATE, status: 'suspended' }))

  const controller = new AffiliateController(
    { findById } as never,
    { list: listCommissions, totals } as never,
    { list: listAttributions } as never,
    { stats: clickStats } as never,
    { get: getSettings } as never,
    { getBalances } as never,
    { execute: updateProfile } as never,
    { execute: leaveProgram } as never,
  )

  return {
    controller,
    spies: {
      findById,
      listCommissions,
      listAttributions,
      getSettings,
      getBalances,
      updateProfile,
      leaveProgram,
    },
  }
}

/** Ключи, которые по конвенции обязаны быть MoneyAmount (строкой). */
const MONEY_KEY = /(_sum$|_amount$|^total_|^balance|_earned$|revshare_rate$|conversion_rate$)/

function moneyFields(value: unknown, path = ''): Array<[string, unknown]> {
  if (value === null || typeof value !== 'object') {
    return []
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, raw]) => {
    const here = path ? `${path}.${key}` : key
    const nested = moneyFields(raw, here)
    if (MONEY_KEY.test(key) && raw !== null && typeof raw !== 'object') {
      return [[here, raw], ...nested]
    }
    return nested
  })
}

describe('Контракт кабинета партнёра (presentation ↔ apps/web)', () => {
  it('me: деньги — строки, баланс по валютам выплаты, tracking_url из кода', async () => {
    process.env['APP_URL'] = 'https://casino.example/'
    const { controller } = makeController()

    const res = await controller.me(ACTOR)

    expect(res).toMatchObject({
      affiliate_id: 'aff-1',
      email: 'partner@example.com',
      status: 'active',
      tracking_code: 'SPIN777',
      revshare_rate: '0.3000',
      revshare_percent: '30',
      payout_currency: 'RUB',
      total_earned: '18420.55',
      terms_version: '2026-09',
      is_agreed: true,
    })
    // хвостовой слэш APP_URL не должен удваиваться: ссылка уходит игрокам
    expect(res.tracking_url).toBe('https://casino.example/go/SPIN777')
    expect(res.balance).toEqual({ RUB: '12420.55', USDT_TRC20: '96.40' })
    for (const [field, value] of moneyFields(res)) {
      expect(typeof value, field).toBe('string')
    }
  })

  it('me: кошелька нет — канонический ноль, а не null и не «0»', async () => {
    const { controller } = makeController({ balances: [] })

    const res = await controller.me(ACTOR)

    expect(res.balance).toEqual({ RUB: '0.00000000', USDT_TRC20: '0.00000000' })
  })

  it('owner-check (А20): id партнёра берётся из actor, репозиторий не видит чужого id', async () => {
    const { controller, spies } = makeController()

    await controller.me(ACTOR)
    await controller.dashboard(ACTOR, { days: 30 })
    await controller.commissions(ACTOR, { page: 2, per_page: 20 })
    await controller.players(ACTOR)
    await controller.links(ACTOR)

    expect(spies.findById).toHaveBeenCalledWith('aff-1')
    expect(spies.listCommissions.mock.calls[0]?.[0]).toMatchObject({ affiliateId: 'aff-1' })
    expect(spies.listAttributions.mock.calls.every((c) => c[0].affiliateId === 'aff-1')).toBe(true)
  })

  it('dashboard: конверсия — строка с двумя знаками, агрегаты — строки', async () => {
    const { controller } = makeController()

    const res = await controller.dashboard(ACTOR, { days: 30 })

    expect(res.period_days).toBe(30)
    expect(res.clicks).toEqual({ total: 1284, converted: 47, conversion_rate: '3.66' })
    expect(res.totals).toEqual({
      total_commission: '18420.55',
      total_ngr: '61402.10',
      total_ggr: '78930.00',
    })
    expect(res.settings).toEqual({
      revshare_rate: '0.3000',
      revshare_percent: '30',
      cookie_days: 30,
    })
  })

  it('dashboard: ноль кликов — конверсия «0.00», а не NaN и не деление на ноль', async () => {
    const { controller } = makeController({ clickStats: { total: 0, converted: 0 } })

    const res = await controller.dashboard(ACTOR, { days: 7 })

    expect(res.clicks.conversion_rate).toBe('0.00')
  })

  it('commissions: конверт {data, meta} и полная разбивка NGR, даты — YYYY-MM-DD', async () => {
    const { controller } = makeController({ commissionsTotal: 12 })

    const res = await controller.commissions(ACTOR, { page: 1, per_page: 20 })

    expect(res.meta).toEqual({ page: 1, perPage: 20, total: 12 })
    expect(res.data[0]).toEqual({
      id: 'cm-1',
      period_start: '2026-09-01',
      period_end: '2026-09-30',
      currency: 'RUB',
      bet_sum: '180000.00',
      win_sum: '101070.00',
      rollback_sum: '0.00',
      bonus_sum: '600.00',
      provider_fee_sum: '0.00',
      ggr_amount: '78930.00',
      ngr_amount: '61402.10',
      revshare_rate: '0.3000',
      commission_amount: '18420.55',
      status: 'credited',
      credited_at: '2026-10-01T03:00:00.000Z',
    })
    for (const [field, value] of moneyFields(res.data[0])) {
      expect(typeof value, field).toBe('string')
    }
  })

  it('players: депозит строкой, meta.total — из репозитория, а не из длины страницы', async () => {
    const { controller } = makeController({ playersTotal: 137 })

    const res = await controller.players(ACTOR)

    expect(res.meta).toEqual({ total: 137 })
    expect(res.data[0]).toMatchObject({
      player_id: 'p-1',
      status: 'qualified',
      total_deposit: '25000.00',
      deposit_count: 6,
      first_deposit_at: '2026-09-12T10:04:00.000Z',
      reject_reason: null,
    })
  })

  /**
   * F4: на квалифицированной строке `reject_reason` — флаг для разбора
   * администратором, а не отказ. Партнёру он показался бы обвинением в
   * перекупке трафика, хотя начисления у него идут.
   */
  it('players: флаг на разбор (F4) партнёру не показывается', async () => {
    const { controller } = makeController({
      playerRows: [{ ...PLAYER_ROW, rejectReason: 'near_threshold_deposit' }],
    })

    const res = await controller.players(ACTOR)

    expect(res.data[0]?.status).toBe('qualified')
    expect(res.data[0]?.reject_reason).toBeNull()
  })

  it('players: настоящая причина отказа остаётся — партнёр может оспорить (§13.3)', async () => {
    const { controller } = makeController({
      playerRows: [{ ...PLAYER_ROW, status: 'rejected', rejectReason: 'self_referral' }],
    })

    const res = await controller.players(ACTOR)

    expect(res.data[0]?.reject_reason).toBe('self_referral')
  })

  it('links: базовая ссылка и deep-link — в том же формате, что и me()', async () => {
    process.env['APP_URL'] = 'https://casino.example'
    const { controller } = makeController()

    const res = await controller.links(ACTOR)

    expect(res.tracking_url).toBe('https://casino.example/go/SPIN777')
    expect(res.cookie_days).toBe(30)
    expect(res.examples.map((e) => e.url)).toContain('https://casino.example/go/SPIN777?p=/casino')
  })
})
