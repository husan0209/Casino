import { Controller, Get, Query, UseGuards } from '@nestjs/common'

import { prisma, type Prisma, type ReferralRewardStatus, type ReferralRewardType } from '@casino/database'

import { AuthGuard } from '../../auth/presentation/guards/auth.guard'
import { Roles, RolesGuard } from '../../auth/presentation/guards/roles.guard'

/**
 * Ручной триггер начислений POST admin/referrals/run-daily (GAP-32/21) переехал
 * в maintenance/presentation/maintenance-admin.controller.ts (решение В2):
 * путь, guards, тело запроса и форма ответа сохранены один-в-один.
 */
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin', 'superadmin')
@Controller('admin/referrals')
export class ReferralsAdminController {
  @Get('stats')
  async stats(): Promise<{ total_referrals: number; total_rewards_paid: string; top_referrers: { user_id: string; email: string | null | undefined; referral_count: number; total_earned: string; }[]; }> {
    const totalReferrals = await prisma.user.count({ where: { referredBy: { not: null } } })
    const paid = await prisma.referralReward.aggregate({
      where: { status: 'credited' },
      _sum: { rewardAmount: true },
    })
    const top = await prisma.referralReward.groupBy({
      by: ['referrerId'],
      _sum: { rewardAmount: true },
      _count: { referredId: true },
      orderBy: { _sum: { rewardAmount: 'desc' } },
      take: 10,
      where: { status: 'credited' },
    })
    const topWithEmail = await Promise.all(
      top.map(
        async (t: {
          referrerId: string
          _count: { referredId: number }
          _sum: { rewardAmount: unknown }
        }) => {
          const u = await prisma.user.findUnique({
            where: { id: t.referrerId },
            select: { email: true },
          })
          return {
            user_id: t.referrerId,
            email: u?.email,
            referral_count: t._count.referredId,
            total_earned: t._sum.rewardAmount?.toString() || '0',
          }
        },
      ),
    )
    return {
      total_referrals: totalReferrals,
      total_rewards_paid: paid._sum.rewardAmount?.toString() || '0',
      top_referrers: topWithEmail,
    }
  }
  @Get()
  async list(@Query() q: Record<string, string | undefined>): Promise<{ data: ({ referrer: { email: string | null; }; referred: { email: string | null; }; } & { id: string; createdAt: Date; type: ReferralRewardType; currency: string; status: ReferralRewardStatus; ledgerEntryId: string | null; rewardAmount: Prisma.Decimal; ggrAmount: Prisma.Decimal; rewardRate: Prisma.Decimal; referrerId: string; referredId: string; periodStart: Date; periodEnd: Date; creditedAt: Date | null; })[]; meta: { page: number; perPage: number; total: number; }; }> {
    const page = parseInt(q.page ?? '') || 1,
      perPage = parseInt(q.per_page ?? '') || 20
    const where: Prisma.ReferralRewardWhereInput = {}
    if (q.referrer_id) {
      where.referrerId = q.referrer_id
    }
    if (q.referred_id) {
      where.referredId = q.referred_id
    }
    const [items, total] = await Promise.all([
      prisma.referralReward.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: { referrer: { select: { email: true } }, referred: { select: { email: true } } },
      }),
      prisma.referralReward.count({ where }),
    ])
    return { data: items, meta: { page, perPage, total } }
  }
}
