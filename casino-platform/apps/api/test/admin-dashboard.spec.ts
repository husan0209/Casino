import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DashboardService,
  type DashPeriod,
} from '../src/modules/admin/application/dashboard.service'

import type { IDashboardRepository } from '../src/modules/admin/domain/admin.repository'

/**
 * UC-ADMIN-DASH-01/02/03 — арифметика и границы периода дашборда.
 *
 * Сервис агрегирует деньги (депозиты, выводы, GGR) и даты, поэтому проверяется
 * три свойства, которые не видны из types:
 *  1) суммы остаются строками и нормализуются через decimal.js, а не float:
 *     `0.005` обязано стать `0.01`, а не `0.00` (в float 0.005 это 0.0049999…);
 *  2) «новых за период» считается ОТ НАЧАЛА ПЕРИОДА, а не от полуночи. Прежняя
 *     реализация передавала `todayStart` для всех периодов, поэтому на 7d/30d/90d
 *     карточка «новые» показывала регистрации только сегодняшних суток —
 *     занижение, которое на скриншоте выглядит правдоподобно и потому не ловится
 *     глазами;
 *  3) ряды графиков zero-filled по дням и метки не зависят от часовой зоны.
 */
const FIXED_NOW = new Date('2026-10-04T15:30:00.000Z')
const TODAY_START = new Date('2026-10-04T00:00:00.000Z')
const DAY_MS = 86_400_000

function periodStart(period: DashPeriod): Date {
  if (period === 'today') {
    return TODAY_START
  }
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90
  return new Date(FIXED_NOW.getTime() - (days - 1) * DAY_MS - 15.5 * 3_600_000)
}

interface RepoCalls {
  countUsersCreatedSince: Date[]
  sumCompletedPaymentsRub: Array<[string, Date | undefined]>
  sumGameTransactions: Array<[string, string, Date]>
}

function makeRepo(over: Partial<Record<string, unknown>> = {}) {
  const calls: RepoCalls = {
    countUsersCreatedSince: [],
    sumCompletedPaymentsRub: [],
    sumGameTransactions: [],
  }
  const num = (key: string, value: number) =>
    vi.fn().mockResolvedValue((over[key] as number | undefined) ?? value)

  const repo = {
    countUsers: num('countUsers', 42),
    countUsersCreatedSince: vi.fn(async (since: Date) => {
      calls.countUsersCreatedSince.push(since)
      return (over.newUsers as number | undefined) ?? 7
    }),
    findActiveUserIds: vi.fn(async () => (over.activeIds as string[] | undefined) ?? ['u1', 'u2']),
    sumCompletedPaymentsRub: vi.fn(async (type: 'deposit' | 'withdrawal', since?: Date) => {
      calls.sumCompletedPaymentsRub.push([type, since])
      const table = over.payments as Record<string, string> | undefined
      const key = since ? `${type}:period` : `${type}:total`
      return table?.[key] ?? (type === 'deposit' ? '1000.10' : '300.20')
    }),
    sumGameTransactions: vi.fn(async (type: 'bet' | 'win', currency: string, since: Date) => {
      calls.sumGameTransactions.push([type, currency, since])
      const table = over.game as Record<string, string> | undefined
      return table?.[type] ?? (type === 'bet' ? '1000.10' : '999.999')
    }),
    countPendingWithdrawals: num('countPendingWithdrawals', 3),
    countPendingKyc: num('countPendingKyc', 5),
    countOpenTickets: num('countOpenTickets', 2),
    registrationsPerDay: vi.fn().mockResolvedValue(over.regPerDay ?? []),
    paymentsPerDay: vi.fn().mockResolvedValue(over.payPerDay ?? []),
    ggrPerDay: vi.fn().mockResolvedValue(over.ggrPerDay ?? []),
    recentPayments: vi.fn().mockResolvedValue(over.feedPayments ?? []),
    recentKyc: vi.fn().mockResolvedValue([]),
    recentBigWins: vi.fn().mockResolvedValue([]),
    recentSignups: vi.fn().mockResolvedValue([]),
    recentTickets: vi.fn().mockResolvedValue([]),
  }

  return { repo: repo as unknown as IDashboardRepository, calls, raw: repo }
}

describe('DashboardService.metrics', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: FIXED_NOW.getTime(), toFake: ['Date'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('деньги — строки с двумя знаками, округление decimal.js, а не float', async () => {
    const { repo } = makeRepo({
      payments: { 'deposit:period': '0.005', 'withdrawal:period': '2.675' },
      game: { bet: '10.005', win: '0.004' },
    })

    const res = await new DashboardService(repo).metrics('today')

    expect(res.finance.deposits).toBe('0.01')
    expect(res.finance.withdrawals).toBe('2.68')
    // GGR считается от УЖЕ округлённых половин (s2 → Decimal → minus): 10.005 → 10.01
    // и 0.004 → 0.00. Важно не «математически точно», а воспроизводимо: ровно так
    // же округляются ставки в отчётах, и сходимость с ledger нарушена не будет.
    expect(res.finance.ggr).toBe('10.01')
    expect(typeof res.finance.deposits).toBe('string')
  })

  it('GGR = ставки минус выигрыши (казино в плюсе на этом)', async () => {
    const { repo } = makeRepo({ game: { bet: '1500.55', win: '999.999' } })

    const res = await new DashboardService(repo).metrics('today')

    expect(res.finance.ggr).toBe('500.55')
  })

  it('суммы за период и за всё время берутся разным вызовом (total без since)', async () => {
    const { repo, calls } = makeRepo()

    await new DashboardService(repo).metrics('7d')

    expect(calls.sumCompletedPaymentsRub).toEqual([
      ['deposit', expect.any(Date)],
      ['withdrawal', expect.any(Date)],
      ['deposit', undefined],
      ['withdrawal', undefined],
    ])
    const periodSince = calls.sumCompletedPaymentsRub[0]?.[1] as Date
    expect(periodSince.toISOString()).toBe(periodStart('7d').toISOString())
  })

  it('new_in_period считает от начала ПЕРИОДА, а не от полуночи (регресс 7d/30d/90d)', async () => {
    for (const period of ['7d', '30d', '90d'] as DashPeriod[]) {
      const { repo, calls } = makeRepo()
      await new DashboardService(repo).metrics(period)
      const since = calls.countUsersCreatedSince[0]
      expect(since?.toISOString(), `period=${period}`).toBe(periodStart(period).toISOString())
    }
  })

  it('active_today привязан к сутки, а не к периоду (это другое поле)', async () => {
    const { repo, calls } = makeRepo()

    const res = await new DashboardService(repo).metrics('30d')

    expect(calls.countUsersCreatedSince.length).toBe(1)
    expect(res.users.active_today).toBe(2)
    expect(res.users).toEqual({ total: 42, new_in_period: 7, active_today: 2 })
  })

  it('pending-счётчики идут своим пакетом и не зависят от периода', async () => {
    const { repo } = makeRepo({
      countPendingWithdrawals: 11,
      countPendingKyc: 4,
      countOpenTickets: 0,
    })

    const res = await new DashboardService(repo).metrics('90d')

    expect(res.pending).toEqual({ withdrawals: 11, kyc: 4, tickets: 0 })
  })
})

describe('DashboardService.charts', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: FIXED_NOW.getTime(), toFake: ['Date'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('7d: метки — 7 UTC-суток подряд, заканчивая сегодня', async () => {
    const { repo } = makeRepo()

    const res = await new DashboardService(repo).charts('7d', 'registrations')

    expect(res.labels).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ])
  })

  it('день без данных = 0, а не пропуск: ряды совпадают по длине с метками', async () => {
    const { repo } = makeRepo({
      regPerDay: [{ day: new Date('2026-10-01T09:00:00Z'), count: 5 }],
    })

    const res = await new DashboardService(repo).charts('7d', 'registrations')
    const datasets = res.datasets as { registrations: number[] }

    expect(datasets.registrations).toEqual([0, 0, 0, 5, 0, 0, 0])
    expect(datasets.registrations.length).toBe(res.labels.length)
  })

  it('revenue: deposits/withdrawals/ggr строками по дням, GGR считается Decimal’ом', async () => {
    const { repo } = makeRepo({
      payPerDay: [
        {
          day: new Date('2026-10-02T00:00:00Z'),
          deposits: '100.004',
          withdrawals: '40',
        },
      ],
      ggrPerDay: [{ day: new Date('2026-10-02T00:00:00Z'), bets: '100.004', wins: '0.004' }],
    })

    const res = await new DashboardService(repo).charts('7d')
    const ds = res.datasets as { deposits: string[]; withdrawals: string[]; ggr: string[] }

    // Метки 7d начинаются с 2026-09-28, поэтому 2026-10-02 — индекс 4
    // (28, 29, 30 сентября, 1, 2 октября).
    expect(ds.deposits).toEqual(['0.00', '0.00', '0.00', '0.00', '100.00', '0.00', '0.00'])
    expect(ds.withdrawals[4]).toBe('40.00')
    expect(ds.ggr[4]).toBe('100.00')
    expect(ds.ggr.filter((v) => v !== '0.00')).toEqual(['100.00'])
  })

  it('today: один день в метках', async () => {
    const { repo } = makeRepo()

    const res = await new DashboardService(repo).charts('today', 'registrations')

    expect(res.labels).toEqual(['2026-10-04'])
  })
})

describe('DashboardService.events', () => {
  const feed = (daysAgo: number, over: Record<string, unknown> = {}) => ({
    createdAt: new Date(FIXED_NOW.getTime() - daysAgo * DAY_MS),
    ...over,
  })

  it('лимит режется в диапазон 1..50 и уходит в репозиторий одним числом', async () => {
    const { repo, raw } = makeRepo()
    const svc = new DashboardService(repo)

    await svc.events(0)
    expect(raw.recentPayments).toHaveBeenLastCalledWith(1)

    await svc.events(999)
    expect(raw.recentPayments).toHaveBeenLastCalledWith(50)
  })

  it('сортировка по времени убывает, лишнее обрезается лимитом', async () => {
    const { repo } = makeRepo({
      feedPayments: [
        feed(3, {
          type: 'deposit',
          amount: '10',
          currency: 'RUB',
          status: 'completed',
          user: { email: 'a@x' },
        }),
        feed(1, {
          type: 'withdrawal',
          amount: '5',
          currency: 'RUB',
          status: 'pending',
          user: { email: 'b@x' },
        }),
        feed(2, {
          type: 'deposit',
          amount: '7',
          currency: 'RUB',
          status: 'completed',
          user: { email: 'c@x' },
        }),
      ],
    })

    const res = await new DashboardService(repo).events(2)

    expect(res.map((e) => e.type)).toEqual(['withdrawal', 'deposit'])
    expect(res[0]?.detail).toBe('b@x: 5 RUB (pending)')
    // Порядок строго убывающий по времени: второй_event не позднее первого.
    expect(res[1]!.at.getTime()).toBeLessThan(res[0]!.at.getTime())
  })

  it('тип платежа маппится в deposit/withdrawal, kyc и тикет идут своими типами', async () => {
    const { repo, raw } = makeRepo({
      feedPayments: [
        feed(0, {
          type: 'withdrawal',
          amount: '1',
          currency: 'RUB',
          status: 'failed',
          user: { email: 'd@x' },
        }),
      ],
    })
    raw.recentTickets = vi
      .fn()
      .mockResolvedValue([feed(0.5, { subject: 'Не пришёл бонус', user: { email: 'e@x' } })])
    raw.recentKyc = vi.fn().mockResolvedValue([
      {
        submittedAt: new Date(FIXED_NOW.getTime() - 0.2 * DAY_MS),
        status: 'pending',
        user: { email: 'f@x' },
      },
    ])

    const res = await new DashboardService(repo).events(5)

    expect(res.map((e) => e.type)).toEqual(['withdrawal', 'kyc', 'ticket'])
    expect(res[0]?.detail).toBe('d@x: 1 RUB (failed)')
    expect(res[1]?.detail).toBe('f@x: pending')
    expect(res[2]?.detail).toBe('e@x: Не пришёл бонус')
  })
})
