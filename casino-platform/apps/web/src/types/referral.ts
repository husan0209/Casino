/**
 * DTO реферальной программы (контракт GET /referrals/*).
 */

/** Ответ GET /referrals/info. */
export interface ReferralInfoDto {
  referral_code: string | null
  referral_link: string
  reward_rate: string
  total_referrals: number
  active_referrals: number
  total_earned: { RUB: string }
  pending_rewards: { RUB: string }
}

/**
 * Строка начисления (GET /referrals/rewards data[]).
 * Контроллер возвращает Prisma ReferralReward as-is (camelCase).
 */
export interface ReferralRewardRow {
  id: string
  referrerId: string
  referredId: string
  type: string
  periodStart: string
  periodEnd: string
  ggrAmount: string
  rewardRate: string
  rewardAmount: string
  currency: string
  status: string
  createdAt: string
}

/** Ответ GET /referrals/rewards. */
export interface ReferralRewardsDto {
  data: ReferralRewardRow[]
  meta: { page: number; perPage: number; total: number }
}
