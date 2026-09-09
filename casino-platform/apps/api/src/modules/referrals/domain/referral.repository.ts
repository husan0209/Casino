/**
 * Репозиторий реферальных начислений. Application-слой не трогает Prisma
 * напрямую (audit §A3/H5).
 *
 * ADR GAP-51 (закрыт 2026-09-04 как ПРИНЯТОЕ РЕШЕНИЕ): чтение gameTransaction
 * (read-only groupBy для GGR) напрямую через общий Prisma-клиент — осознанный
 * компромисс, НЕ долг. Рационале: (а) Prisma-клиент один на приложение,
 * строгая изоляция таблиц в рантайме всё равно невозможна — «порт» был бы тем
 * же SQL с лишним слоем; (б) зависимости `referrals → casino` в MODULE_BOUNDARIES
 * §15/§9 разрешены; (в) money-контур (ledger) не трогается. Порт/событие
 * вводится только при выносе casino в отдельный сервис/БД — отдельное решение
 * владельца на тот момент.
 *
 * (Исторически здесь стоял TODO со ссылкой на GAP-22 — закрытый 2026-08-31 и
 * про другое: 4-слойка wallet, `toMoney`, `runCreditDebit`. Метка указывала на
 * закрытый гэп, и долг не трекся — разобрано при закрытии GAP-48.)
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
