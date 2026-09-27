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

/**
 * Список привлечённых игроков (GET /referrals/list) — форма ReferralsController:
 * id (первые 8 символов uuid), registered_at, is_active, total_earned, currency.
 * Аудит контрактов 2026-09-26: раньше тип описывал {status, created_at} —
 * ключей, которых API не отдаёт.
 */
export interface ReferralListItemDto {
  id: string
  registered_at: string
  is_active: boolean
  total_earned: string
  currency: string
}

/** Ответ GET /referrals/list. */
export interface ReferralsListDto {
  data: ReferralListItemDto[]
  meta: { page: number; perPage: number; total: number }
}
