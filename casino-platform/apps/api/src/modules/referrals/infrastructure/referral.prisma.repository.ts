import { Injectable } from '@nestjs/common'

import { prisma } from '@casino/database'

import {
  type CreateReferralRewardInput,
  type CurrencySumRow,
  type IReferralRepository,
  type ReferredUserRow,
  type ReferralRewardRow,
} from '../domain/referral.repository'

@Injectable()
export class PrismaReferralRepository implements IReferralRepository {
  findReferredUsers(): Promise<ReferredUserRow[]> {
    return prisma.user.findMany({
      where: { referredBy: { not: null } },
      select: { id: true, referredBy: true },
    })
  }

  async sumTransactions(
    userId: string,
    type: string,
    from: Date,
    to: Date,
  ): Promise<CurrencySumRow[]> {
    const rows = await prisma.gameTransaction.groupBy({
      by: ['currency'],
      where: { userId, type: type as never, createdAt: { gte: from, lte: to } },
      _sum: { amount: true },
    })
    return rows.map((r) => ({ currency: r.currency, amount: r._sum.amount?.toString() ?? '0' }))
  }

  findReward(
    referrerId: string,
    referredId: string,
    periodStart: Date,
    currency: string,
  ): Promise<ReferralRewardRow | null> {
    return prisma.referralReward.findFirst({
      where: { referrerId, referredId, periodStart, currency: currency as never },
    })
  }

  createReward(data: CreateReferralRewardInput): Promise<ReferralRewardRow> {
    return prisma.referralReward.create({
      data: { ...data, type: data.type as never, currency: data.currency as never, status: data.status as never },
    })
  }

  async updateReward(id: string, data: { status: string; creditedAt?: Date }): Promise<void> {
    await prisma.referralReward.update({
      where: { id },
      data: { status: data.status as never, ...(data.creditedAt ? { creditedAt: data.creditedAt } : {}) },
    })
  }
}
