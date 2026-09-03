import { Body, Controller, Get, Post, Query, UseGuards, UsePipes } from '@nestjs/common'
import { z } from 'zod'

import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe'
import { prisma, type ReferralRewardStatus, type ReferralRewardType, type Prisma } from '@casino/database'

import { type AuditLogService } from '../../admin/application/audit-log.service'
import { AuthGuard } from '../../auth/presentation/guards/auth.guard'
import { RolesGuard, Roles } from '../../auth/presentation/guards/roles.guard'
import { type ReferralCalcService } from '../application/referral-calc.service'

// GAP-21: ручной триггер начислений — date опционален (YYYY-MM-DD)
export const RunDailySchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
      .optional(),
  })
  .strict()
export type RunDailyDto = z.infer<typeof RunDailySchema>

@UseGuards(AuthGuard, RolesGuard)
@Roles('admin', 'superadmin')
@Controller('admin/referrals')
export class ReferralsAdminController {
  constructor(
    private readonly referralCalc: ReferralCalcService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * GAP-32: ручной запуск реферальных начислений (GGR-share) — только superadmin.
   * Идемпотентен: повторный запуск за тот же день не создаёт вторых проводок
   * (дедуп findReward + idempotencyKey внутри runDaily). Cron-триггер — job
   * `referral-daily` maintenance-очереди (GAP-33).
   */
  @Post('run-daily')
  @Roles('superadmin')
  @UsePipes(new ZodValidationPipe(RunDailySchema))
  async runDaily(
    @Body() dto: RunDailyDto,
    @CurrentUser() admin: { id: string; email?: string },
  ): Promise<{ date: string; processed: number; credited: number; ok: boolean; }> {
    const result = await this.referralCalc.runDaily(dto.date)
    await this.audit.log({
      actorType: 'user',
      actorId: admin.id,
      action: 'referrals.run_daily',
      targetType: 'referral_reward',
      payload: { date: result.date.toISOString().slice(0, 10), processed: result.processed, credited: result.credited },
    })
    return { ok: true, ...result, date: result.date.toISOString().slice(0, 10) }
  }

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
