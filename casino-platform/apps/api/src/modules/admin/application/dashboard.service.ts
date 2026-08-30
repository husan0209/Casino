import { Injectable } from '@nestjs/common'
import Decimal from 'decimal.js'

import { prisma } from '@casino/database'

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

@Injectable()
export class DashboardService {
  // UC-ADMIN-DASH-01
  async metrics(period: DashPeriod = 'today') {
    const since = periodStartDate(period)
    const todayStart = startOfUtcDay()

    const [
      totalUsers,
      newUsers,
      activeRows,
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
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.gameTransaction.findMany({
        where: { createdAt: { gte: todayStart } },
        select: { userId: true },
        distinct: ['userId'],
      }),
      prisma.paymentRequest.aggregate({
        _sum: { amountRub: true },
        where: { type: 'deposit', status: 'completed', createdAt: { gte: since } },
      }),
      prisma.paymentRequest.aggregate({
        _sum: { amountRub: true },
        where: { type: 'withdrawal', status: 'completed', createdAt: { gte: since } },
      }),
      prisma.paymentRequest.aggregate({
        _sum: { amountRub: true },
        where: { type: 'deposit', status: 'completed' },
      }),
      prisma.paymentRequest.aggregate({
        _sum: { amountRub: true },
        where: { type: 'withdrawal', status: 'completed' },
      }),
      prisma.gameTransaction.aggregate({
        _sum: { amount: true },
        where: { type: 'bet', currency: 'RUB', createdAt: { gte: since } },
      }),
      prisma.gameTransaction.aggregate({
        _sum: { amount: true },
        where: { type: 'win', currency: 'RUB', createdAt: { gte: since } },
      }),
      prisma.paymentRequest.count({ where: { type: 'withdrawal', status: 'pending' } }),
      prisma.kycProfile.count({ where: { status: 'pending' } }),
      prisma.supportTicket.count({
        where: { status: { in: ['open', 'in_progress', 'waiting_user'] } },
      }),
    ])

    const ggr = new Decimal(s2(ggrBets._sum.amount)).minus(s2(ggrWins._sum.amount))

    return {
      period,
      users: { total: totalUsers, new_in_period: newUsers, active_today: activeRows.length },
      finance: {
        deposits: s2(depositsSum._sum.amountRub),
        withdrawals: s2(withdrawalsSum._sum.amountRub),
        ggr: ggr.toFixed(2),
        deposits_total: s2(depositsTotal._sum.amountRub),
        withdrawals_total: s2(withdrawalsTotal._sum.amountRub),
      },
      pending: { withdrawals: pendingWithdrawals, kyc: pendingKyc, tickets: openTickets },
    }
  }

  // UC-ADMIN-DASH-02
  async charts(period: DashPeriod = '7d', type: 'revenue' | 'registrations' = 'revenue') {
    const since = periodStartDate(period)
    const totalDays = daysBetween(since)

    const labels: string[] = []
    for (let i = 0; i < totalDays; i++) {
      labels.push(new Date(since.getTime() + i * DAY_MS).toISOString().slice(0, 10))
    }

    if (type === 'registrations') {
      const rows = await prisma.$queryRaw<{ d: Date; cnt: bigint }[]>`
        SELECT date_trunc('day', created_at) AS d, COUNT(*) AS cnt
        FROM users WHERE created_at >= ${since} GROUP BY 1 ORDER BY 1`
      const rowsT = rows as Array<{ d: Date; cnt: bigint }>
      const byDay = new Map<string, number>(
        rowsT.map((r) => [new Date(r.d).toISOString().slice(0, 10), Number(r.cnt)]),
      )
      return { labels, datasets: { registrations: labels.map((l) => byDay.get(l) ?? 0) } }
    }

    const [payRows, ggrRows] = await Promise.all([
      prisma.$queryRaw<{ d: Date; deposits: Decimal; withdrawals: Decimal }[]>`
        SELECT date_trunc('day', created_at) AS d,
               SUM(CASE WHEN type = 'deposit' THEN amount_rub ELSE 0 END) AS deposits,
               SUM(CASE WHEN type = 'withdrawal' THEN amount_rub ELSE 0 END) AS withdrawals
        FROM payment_requests
        WHERE status = 'completed' AND created_at >= ${since}
        GROUP BY 1 ORDER BY 1`,
      prisma.$queryRaw<{ d: Date; bets: Decimal; wins: Decimal }[]>`
        SELECT date_trunc('day', created_at) AS d,
               SUM(CASE WHEN type = 'bet' THEN amount ELSE 0 END) AS bets,
               SUM(CASE WHEN type = 'win' THEN amount ELSE 0 END) AS wins
        FROM game_transactions
        WHERE currency = 'RUB' AND created_at >= ${since}
        GROUP BY 1 ORDER BY 1`,
    ])

    const payRowsT = payRows as Array<{ d: Date; deposits: Decimal; withdrawals: Decimal }>
    const ggrRowsT = ggrRows as Array<{ d: Date; bets: Decimal; wins: Decimal }>
    const payByDay = new Map<string, { deposits: Decimal; withdrawals: Decimal }>(
      payRowsT.map((r) => [
        new Date(r.d).toISOString().slice(0, 10),
        { deposits: r.deposits, withdrawals: r.withdrawals },
      ]),
    )
    const ggrByDay = new Map<string, { bets: Decimal; wins: Decimal }>(
      ggrRowsT.map((r) => [
        new Date(r.d).toISOString().slice(0, 10),
        { bets: r.bets, wins: r.wins },
      ]),
    )

    return {
      labels,
      datasets: {
        deposits: labels.map((l) => s2(payByDay.get(l)?.deposits)),
        withdrawals: labels.map((l) => s2(payByDay.get(l)?.withdrawals)),
        ggr: labels.map((l) =>
          new Decimal(s2(ggrByDay.get(l)?.bets)).minus(s2(ggrByDay.get(l)?.wins)).toFixed(2),
        ),
      },
    }
  }

  // UC-ADMIN-DASH-03
  async events(limit = 10) {
    const capped = Math.min(Math.max(limit, 1), 50)
    const [payments, kycs, bigWins, signups, tickets] = await Promise.all([
      prisma.paymentRequest.findMany({
        take: capped,
        orderBy: { createdAt: 'desc' },
        select: {
          createdAt: true,
          type: true,
          status: true,
          amount: true,
          currency: true,
          user: { select: { email: true } },
        },
      }),
      prisma.kycProfile.findMany({
        where: { submittedAt: { not: null } },
        take: capped,
        orderBy: { submittedAt: 'desc' },
        select: { submittedAt: true, status: true, user: { select: { email: true } } },
      }),
      prisma.gameTransaction.findMany({
        where: { type: 'win', amount: { gte: BIG_WIN_THRESHOLD } },
        take: capped,
        orderBy: { createdAt: 'desc' },
        select: {
          createdAt: true,
          amount: true,
          currency: true,
          user: { select: { email: true } },
        },
      }),
      prisma.user.findMany({
        take: capped,
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, email: true },
      }),
      prisma.supportTicket.findMany({
        take: capped,
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, subject: true, user: { select: { email: true } } },
      }),
    ])

    const merged = [
      ...(
        payments as Array<{
          createdAt: Date
          type: string
          status: string
          amount: any
          currency: string
          user: { email: string | null }
        }>
      ).map((p) => ({
        at: p.createdAt,
        type: p.type === 'deposit' ? 'deposit' : 'withdrawal',
        detail: `${p.user.email}: ${p.amount} ${p.currency} (${p.status})`,
      })),
      ...(
        kycs as Array<{ submittedAt: Date | null; status: string; user: { email: string | null } }>
      ).map((k) => ({ at: k.submittedAt!, type: 'kyc', detail: `${k.user.email}: ${k.status}` })),
      ...(
        bigWins as Array<{
          createdAt: Date
          amount: any
          currency: string
          user: { email: string | null }
        }>
      ).map((w) => ({
        at: w.createdAt,
        type: 'big_win',
        detail: `${w.user.email}: выиграл ${w.amount} ${w.currency}`,
      })),
      ...(signups as Array<{ createdAt: Date; email: string | null }>).map((u) => ({
        at: u.createdAt,
        type: 'registration',
        detail: u.email ?? '',
      })),
      ...(
        tickets as Array<{ createdAt: Date; subject: string; user: { email: string | null } }>
      ).map((t) => ({ at: t.createdAt, type: 'ticket', detail: `${t.user.email}: ${t.subject}` })),
    ]

    return merged.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, capped)
  }
}
