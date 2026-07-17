import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { AuthGuard } from '../../auth/presentation/guards/auth.guard'
import { RolesGuard, Roles } from '../../auth/presentation/guards/roles.guard'
import { prisma } from '@casino/database'

@UseGuards(AuthGuard, RolesGuard)
@Roles('admin','superadmin')
@Controller('admin/referrals')
export class ReferralsAdminController {
  @Get('stats')
  async stats(){
    const totalReferrals = await prisma.user.count({ where:{ referredBy: { not: null }}})
    const paid = await prisma.referralReward.aggregate({ where:{ status:'credited' }, _sum:{ rewardAmount: true }})
    const top = await prisma.referralReward.groupBy({
      by: ['referrerId'],
      _sum: { rewardAmount: true },
      _count: { referredId: true },
      orderBy: { _sum: { rewardAmount: 'desc' }},
      take: 10,
      where: { status: 'credited' }
    })
    const topWithEmail = await Promise.all(top.map(async t => {
      const u = await prisma.user.findUnique({ where:{ id: t.referrerId }, select:{ email:true }})
      return { user_id: t.referrerId, email: u?.email, referral_count: t._count.referredId, total_earned: t._sum.rewardAmount?.toString() || '0' }
    }))
    return { total_referrals: totalReferrals, total_rewards_paid: paid._sum.rewardAmount?.toString() || '0', top_referrers: topWithEmail }
  }
  @Get()
  async list(@Query() q:any){
    const page = parseInt(q.page)||1, perPage = parseInt(q.per_page)||20
    const where:any = {}
    if(q.referrer_id) where.referrerId = q.referrer_id
    if(q.referred_id) where.referredId = q.referred_id
    const [items,total] = await Promise.all([
      prisma.referralReward.findMany({ where, skip:(page-1)*perPage, take:perPage, orderBy:{ createdAt: 'desc' }, include:{ referrer:{ select:{ email:true }}, referred:{ select:{ email:true }}} }),
      prisma.referralReward.count({ where })
    ])
    return { data: items, meta:{ page, perPage, total }}
  }
}
