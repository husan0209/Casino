/**
 * Репозиторий реферальных начислений. Application-слой не трогает Prisma
 * напрямую (audit §A3/H5). Чтение gameTransaction (ставки/выигрыши) —
 * cross-module компромисс, TODO(GAP-22): вынести в Facade casino-модуля.
 */
import type { ReferralReward } from '@prisma/client'

export type ReferralRewardRow = ReferralReward

export interface ReferredUserRow {
  id: string
  referredBy: string | null
}

export interface CurrencySumRow {
  currency: string
  amount: string
}

export interface CreateReferralRewardInput {
  referrerId: string
  referredId: string
  type: string
  periodStart: Date
  periodEnd: Date
  ggrAmount: string
  rewardRate: string
  rewardAmount: string
  currency: string
  status: string
}

export interface IReferralRepository {
  /** Все пользователи, у которых заполнен referredBy. */
  findReferredUsers(): Promise<ReferredUserRow[]>
  /** Суммы bet/win-транзакций пользователя за период, сгруппированные по валютам. */
  sumTransactions(args: {
    userId: string
    type: string
    from: Date
    to: Date
  }): Promise<CurrencySumRow[]>
  findReward(args: {
    referrerId: string
    referredId: string
    periodStart: Date
    currency: string
  }): Promise<ReferralRewardRow | null>
  createReward(data: CreateReferralRewardInput): Promise<ReferralRewardRow>
  updateReward(
    id: string,
    data: { status: string; creditedAt?: Date },
  ): Promise<void>
}

export const REFERRAL_REPOSITORY = Symbol('REFERRAL_REPOSITORY')
