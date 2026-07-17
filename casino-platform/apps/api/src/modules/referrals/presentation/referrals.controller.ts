import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { AuthGuard } from '../../auth/presentation/guards/auth.guard'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import { prisma } from '@casino/database'

@UseGuards(AuthGuard)
@Controller('referrals')
export class ReferralsController {
  @Get('info')
  async info(@CurrentUser() u:any){
    const user = await prisma.user.findUnique({ where:{ id: u.id }, select:{ referralCode:true }})
    const totalReferrals = await prisma.user.count({ where:{ referredBy: u.id }})
    const agg = await prisma.referralReward.aggregate({
      where:{ referrerId: u.id, status:'credited' },
      _sum:{ rewardAmount:true }
    })
    const refLink = (process.env.APP_URL || 'http://localhost:3000') + '?ref=' + user?.referralCode
    return {
      referral_code: user?.referralCode,
      referral_link: refLink,
      reward_rate: '5%',
      total_referrals: totalReferrals,
      active_referrals: totalReferrals,
      total_earned: { RUB: agg._sum.rewardAmount?.toString() || '0' },
      pending_rewards: { RUB: '0' }
    }
  }
  @Get('list')
  async list(@CurrentUser() u:any, @Query() q:any){
    const page = parseInt(q.page)||1, perPage = parseInt(q.per_page)||20
    const [items,total] = await Promise.all([
      prisma.user.findMany({ where:{ referredBy: u.id }, skip:(page-1)*perPage, take:perPage, select:{ id:true, createdAt:true }}),
      prisma.user.count({ where:{ referredBy: u.id }})
    ])
    return { data: items.map((x,i)=>({ id: x.id.slice(0,8), registered_at: x.createdAt, is_active:true, total_earned:'0', currency:'RUB'})), meta:{ page, perPage, total }}
  }
  @Get('rewards')
  async rewards(@CurrentUser() u:any, @Query() q:any){
    const page = parseInt(q.page)||1, perPage = parseInt(q.per_page)||20
    const [items,total] = await Promise.all([
      prisma.referralReward.findMany({ where:{ referrerId: u.id }, skip:(page-1)*perPage, take:perPage, orderBy:{ periodStart:'desc' }}),
      prisma.referralReward.count({ where:{ referrerId: u.id }})
    ])
    return { data: items, meta:{ page, perPage, total }}
  }
}
