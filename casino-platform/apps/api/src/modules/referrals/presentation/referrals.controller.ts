import { Controller, Get, Query, UseGuards } from '@nestjs/common'

import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { prisma, type ReferralRewardStatus, type ReferralRewardType, type Prisma } from '@casino/database'

import { AuthGuard } from '../../auth/presentation/guards/auth.guard'

@UseGuards(AuthGuard)
@Controller('referrals')
export class ReferralsController {
  @Get('info')
  async info(@CurrentUser() currentUser: { id: string }): Promise<{ referral_code: string | undefined; referral_link: string; reward_rate: string; total_referrals: number; active_referrals: number; total_earned: { RUB: string; }; pending_rewards: { RUB: string; }; }> {
    const user = await prisma.user.findUnique({
      where: { id: currentUser.id },
      select: { referralCode: true },
    })
    const totalReferrals = await prisma.user.count({
      where: { referredBy: currentUser.id },
    })
    const aggregated = await prisma.referralReward.aggregate({
      where: { referrerId: currentUser.id, status: 'credited' },
      _sum: { rewardAmount: true },
    })
    const appUrl = process.env['APP_URL'] || 'http://localhost:3000'
    const referralLink = `${appUrl}?ref=${user?.referralCode || ''}`

    return {
      referral_code: user?.referralCode,
      referral_link: referralLink,
      reward_rate: '5%',
      total_referrals: totalReferrals,
      active_referrals: totalReferrals,
      total_earned: {
        RUB: aggregated._sum.rewardAmount?.toString() || '0',
      },
      pending_rewards: {
        RUB: '0',
      },
    }
  }

  @Get('list')
  async list(
    @CurrentUser() currentUser: { id: string },
    @Query() queryParams: { page?: string; per_page?: string },
  ): Promise<{ data: { id: string; registered_at: Date; is_active: boolean; total_earned: string; currency: string; }[]; meta: { page: number; perPage: number; total: number; }; }> {
    const page = parseInt(queryParams.page || '1', 10) || 1
    const perPage = parseInt(queryParams.per_page || '20', 10) || 20

    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where: { referredBy: currentUser.id },
        skip: (page - 1) * perPage,
        take: perPage,
        select: { id: true, createdAt: true },
      }),
      prisma.user.count({
        where: { referredBy: currentUser.id },
      }),
    ])

    const data = items.map((item: { id: string; createdAt: Date }) => ({
      id: item.id.slice(0, 8),
      registered_at: item.createdAt,
      is_active: true,
      total_earned: '0',
      currency: 'RUB',
    }))

    return {
      data,
      meta: { page, perPage, total },
    }
  }

  @Get('rewards')
  async rewards(
    @CurrentUser() currentUser: { id: string },
    @Query() queryParams: { page?: string; per_page?: string },
  ): Promise<{ data: { id: string; createdAt: Date; type: ReferralRewardType; currency: string; status: ReferralRewardStatus; ledgerEntryId: string | null; rewardAmount: Prisma.Decimal; ggrAmount: Prisma.Decimal; rewardRate: Prisma.Decimal; referrerId: string; referredId: string; periodStart: Date; periodEnd: Date; creditedAt: Date | null; }[]; meta: { page: number; perPage: number; total: number; }; }> {
    const page = parseInt(queryParams.page || '1', 10) || 1
    const perPage = parseInt(queryParams.per_page || '20', 10) || 20

    const [items, total] = await Promise.all([
      prisma.referralReward.findMany({
        where: { referrerId: currentUser.id },
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { periodStart: 'desc' },
      }),
      prisma.referralReward.count({
        where: { referrerId: currentUser.id },
      }),
    ])

    return {
      data: items,
      meta: { page, perPage, total },
    }
  }
}
