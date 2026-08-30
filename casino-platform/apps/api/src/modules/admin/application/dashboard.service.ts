import { Inject, Injectable } from '@nestjs/common'
import Decimal from 'decimal.js'

import {
  DASHBOARD_REPOSITORY,
  type IDashboardRepository,
} from '../domain/admin.repository'

export type DashPeriod = 'today' | '7d' | '30d' | '90d'

const DAY_MS = 86_400_000
const BIG_WIN_THRESHOLD = '10000'

function startOfUtcDay(d: Date | number = new Date()): Date {
  const x = new Date(d)
  x.setUTCHours(0, 0, 0, 0)
  return x
}

function periodStartDate(p: DashPeriod): Date {
  if (p === 'today') {
    return startOfUtcDay()
  }
  const days = p === '7d' ? 7 : p === '30d' ? 30 : 90
  return new Date(startOfUtcDay(Date.now() - (days - 1) * DAY_MS))
}

function daysBetween(since: Date): number {
  return Math.round((startOfUtcDay().getTime() - since.getTime()) / DAY_MS) + 1
}

const s2 = (v: unknown): string => new Decimal((v as any)?.toString?.() ?? '0').toFixed(2)

function dayLabels(since: Date, totalDays: number): string[] {
  const labels: string[] = []
  for (let i = 0; i < totalDays; i++) {
    labels.push(new Date(since.getTime() + i * DAY_MS).toISOString().slice(0, 10))
  }
  return labels
}

function byDay<T>(rows: Array<{ day: Date } & T>): Map<string, T> {
  return new Map<string, T>(rows.map((r) => [r.day.toISOString().slice(0, 10), r]))
}

@Injectable()
export class DashboardService {
  constructor(@Inject(DASHBOARD_REPOSITORY) private readonly repo: IDashboardRepository) {}

  // UC-ADMIN-DASH-01
  async metrics(period: DashPeriod = 'today') {
    const since = periodStartDate(period)
    const todayStart = startOfUtcDay()

    const [
      totalUsers,
      newUsers,
      activeUserIds,
      depositsSum,
      withdrawalsSum,
      depositsTotal,
      withdrawalsTotal,
      ggrBets,
      ggrWins,
      pendingWithdrawals,
      pendingKyc,
      openTickets,
    ] = await Promise.all([
      this.repo.countUsers(),
      this.repo.countUsersCreatedSince(todayStart),
      this.repo.findActiveUserIds(todayStart),
      this.repo.sumCompletedPaymentsRub('deposit', since),
      this.repo.sumCompletedPaymentsRub('withdrawal', since),
      this.repo.sumCompletedPaymentsRub('deposit'),
      this.repo.sumCompletedPaymentsRub('withdrawal'),
      this.repo.sumGameTransactions('bet', 'RUB', since),
      this.repo.sumGameTransactions('win', 'RUB', since),
      this.repo.countPendingWithdrawals(),
      this.repo.countPendingKyc(),
      this.repo.countOpenTickets(),
    ])

    const ggr = new Decimal(s2(ggrBets)).minus(s2(ggrWins))

    return {
      period,
      users: { total: totalUsers, new_in_period: newUsers, active_today: activeUserIds.length },
      finance: {
        deposits: s2(depositsSum),
        withdrawals: s2(withdrawalsSum),
        ggr: ggr.toFixed(2),
        deposits_total: s2(depositsTotal),
        withdrawals_total: s2(withdrawalsTotal),
      },
      pending: { withdrawals: pendingWithdrawals, kyc: pendingKyc, tickets: openTickets },
    }
  }

  // UC-ADMIN-DASH-02
  async charts(period: DashPeriod = '7d', type: 'revenue' | 'registrations' = 'revenue') {
    const since = periodStartDate(period)
    const labels = dayLabels(since, daysBetween(since))

    if (type === 'registrations') {
      const rows = byDay(await this.repo.registrationsPerDay(since))
      return { labels, datasets: { registrations: labels.map((l) => rows.get(l)?.count ?? 0) } }
    }

    const [payRows, ggrRows] = await Promise.all([
      byDay(await this.repo.paymentsPerDay(since)),
      byDay(await this.repo.ggrPerDay(since)),
    ])

    return {
      labels,
      datasets: {
        deposits: labels.map((l) => s2(payRows.get(l)?.deposits)),
        withdrawals: labels.map((l) => s2(payRows.get(l)?.withdrawals)),
        ggr: labels.map((l) =>
          new Decimal(s2(ggrRows.get(l)?.bets)).minus(s2(ggrRows.get(l)?.wins)).toFixed(2),
        ),
      },
    }
  }

  // UC-ADMIN-DASH-03
  async events(limit = 10) {
    const capped = Math.min(Math.max(limit, 1), 50)
    const [payments, kycs, bigWins, signups, tickets] = await Promise.all([
      this.repo.recentPayments(capped),
      this.repo.recentKyc(capped),
      this.repo.recentBigWins(capped, BIG_WIN_THRESHOLD),
      this.repo.recentSignups(capped),
      this.repo.recentTickets(capped),
    ])

    const merged = [
      ...payments.map((p) => ({
        at: p.createdAt,
        type: p.type === 'deposit' ? 'deposit' : 'withdrawal',
        detail: `${p.user.email}: ${p.amount} ${p.currency} (${p.status})`,
      })),
      ...kycs.map((k) => ({
        at: k.submittedAt as Date,
        type: 'kyc',
        detail: `${k.user.email}: ${k.status}`,
      })),
      ...bigWins.map((w) => ({
        at: w.createdAt,
        type: 'big_win',
        detail: `${w.user.email}: выиграл ${w.amount} ${w.currency}`,
      })),
      ...signups.map((u) => ({ at: u.createdAt, type: 'registration', detail: u.email ?? '' })),
      ...tickets.map((t) => ({
        at: t.createdAt,
        type: 'ticket',
        detail: `${t.user.email}: ${t.subject}`,
      })),
    ]

    return merged.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, capped)
  }
}
