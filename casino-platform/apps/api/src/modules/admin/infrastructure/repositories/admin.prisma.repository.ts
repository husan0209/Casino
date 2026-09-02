import { Injectable } from '@nestjs/common'

import { prisma } from '@casino/database'


import {
  type AdminFeedBigWin,
  type AdminFeedKyc,
  type AdminFeedPayment,
  type AdminFeedSignup,
  type AdminFeedTicket,
  type AdminUserRow,
  type AuditLogInput,
  type CreateAdminUserInput,
  type IAuditLogRepository,
  type IDashboardRepository,
  type IAdminUserRepository,
  type PerDayGgr,
  type PerDaySum,
} from '../../domain/admin.repository'

const OPEN_TICKET_STATUSES = ['open', 'in_progress', 'waiting_user']

@Injectable()
export class PrismaAdminUserRepository implements IAdminUserRepository {
  async list(page: number, perPage: number): Promise<{ items: AdminUserRow[]; total: number }> {
    const [items, total] = await prisma.$transaction([
      prisma.adminUser.findMany({
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
        },
      }),
      prisma.adminUser.count(),
    ])
    return { items, total }
  }

  create(data: CreateAdminUserInput): Promise<AdminUserRow> {
    return prisma.adminUser.create({
      data: {
        email: data.email.toLowerCase(),
        passwordHash: data.passwordHash,
        role: data.role as never,
        ...(data.firstName !== undefined && { firstName: data.firstName }),
        ...(data.lastName !== undefined && { lastName: data.lastName }),
        ...(data.createdBy !== undefined && { createdBy: data.createdBy }),
      },
    })
  }

  setActive(id: string, isActive: boolean): Promise<AdminUserRow> {
    return prisma.adminUser.update({ where: { id }, data: { isActive } })
  }
}

@Injectable()
export class PrismaAuditLogRepository implements IAuditLogRepository {
  async log(input: AuditLogInput): Promise<void> {
    // Явный маппинг вместо spread: AuditLogInput.ipAddress/userAgent могут быть undefined
    // (express req.ip), а Prisma-тип при exactOptionalPropertyTypes не принимает явный
    // undefined — опциональные поля включаем в data только когда они заданы.
    await prisma.auditLog.create({
      data: {
        actorType: input.actorType,
        actorId: input.actorId,
        action: input.action,
        ...(input.targetType !== undefined && { targetType: input.targetType }),
        ...(input.targetId !== undefined && { targetId: input.targetId }),
        ...(input.payload !== undefined && { payload: input.payload }),
        ...(input.ipAddress !== undefined && { ipAddress: input.ipAddress }),
        ...(input.userAgent !== undefined && { userAgent: input.userAgent }),
      },
    })
  }
}

@Injectable()
export class PrismaDashboardRepository implements IDashboardRepository {
  countUsers(): Promise<number> {
    return prisma.user.count()
  }

  countUsersCreatedSince(since: Date): Promise<number> {
    return prisma.user.count({ where: { createdAt: { gte: since } } })
  }

  async findActiveUserIds(since: Date): Promise<string[]> {
    const rows = await prisma.gameTransaction.findMany({
      where: { createdAt: { gte: since } },
      select: { userId: true },
      distinct: ['userId'],
    })
    return rows.map((r) => r.userId)
  }

  async sumCompletedPaymentsRub(type: 'deposit' | 'withdrawal', since?: Date): Promise<string> {
    const res = await prisma.paymentRequest.aggregate({
      _sum: { amountRub: true },
      where: {
        type,
        status: 'completed',
        ...(since ? { createdAt: { gte: since } } : {}),
      },
    })
    return res._sum.amountRub?.toString() ?? '0'
  }

  async sumGameTransactions(type: 'bet' | 'win', currency: string, since: Date): Promise<string> {
    const res = await prisma.gameTransaction.aggregate({
      _sum: { amount: true },
      where: { type, currency: currency as never, createdAt: { gte: since } },
    })
    return res._sum.amount?.toString() ?? '0'
  }

  countPendingWithdrawals(): Promise<number> {
    return prisma.paymentRequest.count({ where: { type: 'withdrawal', status: 'pending' } })
  }

  countPendingKyc(): Promise<number> {
    return prisma.kycProfile.count({ where: { status: 'pending' } })
  }

  countOpenTickets(): Promise<number> {
    return prisma.supportTicket.count({
      where: { status: { in: OPEN_TICKET_STATUSES as never } },
    })
  }

  async registrationsPerDay(since: Date): Promise<Array<{ day: Date; count: number }>> {
    const rows = await prisma.$queryRaw<{ d: Date; cnt: bigint }[]>`
      SELECT date_trunc('day', created_at) AS d, COUNT(*) AS cnt
      FROM users WHERE created_at >= ${since} GROUP BY 1 ORDER BY 1`
    return rows.map((r) => ({ day: new Date(r.d), count: Number(r.cnt) }))
  }

  async paymentsPerDay(since: Date): Promise<PerDaySum[]> {
    const rows = await prisma.$queryRaw<{ d: Date; deposits: unknown; withdrawals: unknown }[]>`
      SELECT date_trunc('day', created_at) AS d,
             SUM(CASE WHEN type = 'deposit' THEN amount_rub ELSE 0 END) AS deposits,
             SUM(CASE WHEN type = 'withdrawal' THEN amount_rub ELSE 0 END) AS withdrawals
      FROM payment_requests
      WHERE status = 'completed' AND created_at >= ${since}
      GROUP BY 1 ORDER BY 1`
    return rows.map((r) => ({
      day: new Date(r.d),
      deposits: numToString(r.deposits),
      withdrawals: numToString(r.withdrawals),
    }))
  }

  async ggrPerDay(since: Date): Promise<PerDayGgr[]> {
    const rows = await prisma.$queryRaw<{ d: Date; bets: unknown; wins: unknown }[]>`
      SELECT date_trunc('day', created_at) AS d,
             SUM(CASE WHEN type = 'bet' THEN amount ELSE 0 END) AS bets,
             SUM(CASE WHEN type = 'win' THEN amount ELSE 0 END) AS wins
      FROM game_transactions
      WHERE currency = 'RUB' AND created_at >= ${since}
      GROUP BY 1 ORDER BY 1`
    return rows.map((r) => ({
      day: new Date(r.d),
      bets: numToString(r.bets),
      wins: numToString(r.wins),
    }))
  }

  recentPayments(limit: number): Promise<AdminFeedPayment[]> {
    return prisma.paymentRequest.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        createdAt: true,
        type: true,
        status: true,
        amount: true,
        currency: true,
        user: { select: { email: true } },
      },
    })
  }

  recentKyc(limit: number): Promise<AdminFeedKyc[]> {
    return prisma.kycProfile.findMany({
      where: { submittedAt: { not: null } },
      take: limit,
      orderBy: { submittedAt: 'desc' },
      select: { submittedAt: true, status: true, user: { select: { email: true } } },
    })
  }

  recentBigWins(limit: number, minAmount: string): Promise<AdminFeedBigWin[]> {
    return prisma.gameTransaction.findMany({
      where: { type: 'win', amount: { gte: minAmount } },
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        createdAt: true,
        amount: true,
        currency: true,
        user: { select: { email: true } },
      },
    })
  }

  recentSignups(limit: number): Promise<AdminFeedSignup[]> {
    return prisma.user.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, email: true },
    })
  }

  recentTickets(limit: number): Promise<AdminFeedTicket[]> {
    return prisma.supportTicket.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, subject: true, user: { select: { email: true } } },
    })
  }
}

/** Decimal/bigint/string → строка ('0' для null/пустых значений SQL SUM). */
function numToString(v: unknown): string {
  return v?.toString?.() ?? '0'
}
