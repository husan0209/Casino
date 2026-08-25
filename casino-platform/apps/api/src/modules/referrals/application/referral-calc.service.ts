import { Injectable, Logger } from '@nestjs/common'
import Decimal from 'decimal.js'

import { prisma } from '@casino/database'
import { money } from '@casino/shared-utils'

@Injectable()
export class ReferralCalcService {
  private logger = new Logger(ReferralCalcService.name)
  async runDaily(dateStr?: string) {
    const date = dateStr ? new Date(dateStr) : new Date(Date.now() - 86400000)
    const dayStart = new Date(date); dayStart.setUTCHours(0,0,0,0)
    const dayEnd = new Date(dayStart); dayEnd.setUTCHours(23,59,59,999)
    const rewardRate = new Decimal(process.env['REFERRAL_REWARD_RATE'] || '0.05')
    // get all users with referrer
    const referredUsers = await prisma.user.findMany({ where: { referredBy: { not: null }}, select: { id: true, referredBy: true }})
    let processed = 0, credited = 0
    for (const ru of referredUsers) {
      if (!ru.referredBy) continue
      // GGR per currency
      const bets = await prisma.gameTransaction.groupBy({
        by: ['currency'],
        where: { userId: ru.id, type: 'bet', createdAt: { gte: dayStart, lte: dayEnd }},
        _sum: { amount: true }
      })
      const wins = await prisma.gameTransaction.groupBy({
        by: ['currency'],
        where: { userId: ru.id, type: 'win', createdAt: { gte: dayStart, lte: dayEnd }},
        _sum: { amount: true }
      })
      const currencies = new Set<string>([...bets.map((b: { currency: string })=>b.currency), ...wins.map((w: { currency: string })=>w.currency)])
      for (const cur of currencies) {
        const betSum = bets.find((b: { currency: string })=>b.currency===cur)?._sum.amount ?? '0'
        const winSum = wins.find((w: { currency: string })=>w.currency===cur)?._sum.amount ?? '0'
        const ggr = new Decimal(betSum).minus(winSum)
        const isPositiveGgr = ggr.gt(0)
        const status = isPositiveGgr ? 'pending' : 'zero'
        const rewardAmount = isPositiveGgr ? ggr.times(rewardRate).toFixed(8) : '0'
        const exists = await prisma.referralReward.findFirst({
          where: { referrerId: ru.referredBy, referredId: ru.id, periodStart: dayStart, currency: cur }
        })
        if (exists) continue
        const rr = await prisma.referralReward.create({
          data: {
            referrerId: ru.referredBy, referredId: ru.id,
            type: 'ggr_share',
            periodStart: dayStart, periodEnd: dayEnd,
            ggrAmount: isPositiveGgr ? ggr.toFixed(8) : '0',
            rewardRate: rewardRate.toFixed(4),
            rewardAmount,
            currency: cur,
            status: status as any,
          }
        })
        processed++
        if (isPositiveGgr && money.isPositive(rewardAmount)) {
          // credit marked directly – real payout wiring pending DI in referrals.module
          await prisma.referralReward.update({ where: { id: rr.id }, data: { status: 'credited', creditedAt: new Date() }})
          credited++
        }
      }
    }
    this.logger.log(`Referral daily: processed=${processed} credited=${credited} date=${dayStart.toISOString().slice(0,10)}`)
    return { processed, credited, date: dayStart }
  }
}
