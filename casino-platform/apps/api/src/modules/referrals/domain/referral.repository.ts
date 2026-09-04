/**
 * Репозиторий реферальных начислений. Application-слой не трогает Prisma
 * напрямую (audit §A3/H5). Чтение gameTransaction (ставки/выигрыши) —
 * cross-module компромисс: таблица принадлежит casino-модулю, а зависимости
 * `referrals → casino` в MODULE_BOUNDARIES описаны как событие/порт, не прямое
 * чтение. Вынести в порт casino-модуля — см. **GAP-51**.
 *
 * (Раньше здесь стоял TODO со ссылкой на GAP-22, но тот гэп закрыт 2026-08-31 и
 * про другое: 4-слойка wallet, `toMoney`, `runCreditDebit` — эта работа в его
 * критериях не значилась, то есть метка указывала на закрытый гэп и долг не трекся.)
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
