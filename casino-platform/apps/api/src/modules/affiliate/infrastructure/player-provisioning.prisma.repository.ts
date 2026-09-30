/**
 * Prisma-реализация порта внешних read-запросов партнёрской программы.
 *
 * Таблицы users и kyc_profiles принадлежат модулям users/kyc. Affiliate их
 * только читает (и создаёт user-запись партнёра, на которую вешается кошелёк),
 * поэтому обход идёт через порт `AffiliatePlayerProvisioningRepository`, а не
 * через прямой импорт Prisma в application-слой (AI_DEVELOPMENT_RULES §3.2).
 *
 * ADR-обоснование — согласуется с уже принятым ADR GAP-51 для referrals.
 */
import { Injectable } from '@nestjs/common'

import { prisma } from '@casino/database'

import type { AffiliatePlayerProvisioningRepository } from '../domain/repositories/affiliate.repository'

/** Префикс служебных referral_code партнёра — в данных видно, что это не игровой код. */
const AFFILIATE_REFERRAL_PREFIX = 'aff'

@Injectable()
export class PrismaPlayerProvisioningRepository implements AffiliatePlayerProvisioningRepository {
  async createPlayerUser(args: { referralCode: string }): Promise<{ id: string }> {
    const user = await prisma.user.create({
      data: {
        // email у партнёра живёт в affiliates.email. Поле users.email уникально
        // и nullable, поэтому оставляем пустым: один и тот же человек может
        // быть и игроком, и партнёром, не создавая конфликта уникальности.
        email: null,
        status: 'active',
        referralCode: args.referralCode,
      },
      select: { id: true },
    })
    return user
  }

  async deletePlayerUser(userId: string): Promise<void> {
    await prisma.user.delete({ where: { id: userId } })
  }

  async isPlayerReferralCodeAvailable(code: string): Promise<boolean> {
    const existing = await prisma.user.findUnique({
      where: { referralCode: code },
      select: { id: true },
    })
    return existing === null
  }

  async isKycApproved(playerId: string): Promise<boolean> {
    const profile = await prisma.kycProfile.findUnique({
      where: { userId: playerId },
      select: { status: true },
    })
    return profile?.status === 'approved'
  }
}

export { AFFILIATE_REFERRAL_PREFIX }
