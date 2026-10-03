/**
 * Доменная модель партнёрской программы (ТЗ ч.8 §6).
 *
 * Entity — чистые данные без I/O. Слой domain не импортирует Prisma/NestJS
 * (ARCHITECTURE §5.1, AI_DEVELOPMENT_RULES §3.2).
 */
import type { AffiliateProfileRow, AffiliateStatus } from '@casino/shared-types'

import type { RevShareRate } from '../value-objects/revshare-rate.value-object'

/** Read-формы партнёра для внешних ответов API (статус и публичная строка)
 *  живут в @casino/shared-types (В4); тут реэкспорт для потребителей домена и
 *  репозиторных портов. Сам `AffiliateEntity` остаётся доменной сущностью:
 *  у неё есть `passwordHash` и доменные инварианты, поэтому наружу она не
 *  публикуется. */
export type { AffiliateProfileRow, AffiliateStatus }

/** Статус атрибуции игрока. */
export type AffiliateAttributionStatus = 'pending' | 'qualified' | 'rejected'

/** Статус начисления. `pending` — создано, но ещё не зачислено на кошелёк. */
export type AffiliateCommissionStatus = 'pending' | 'approved' | 'paid' | 'cancelled'

/**
 * Коды причин отказа в квалификации (ТЗ ч.8 §11.4, §13.3).
 *
 * self_exclusion добавлен вместе с вариантом C (clawback): игрок осознанно
 * отказался от игры → начисление отменяется, деньги возвращаются партнёру.
 */
export const AFFILIATE_REJECT_REASONS = [
  'self_referral',
  'self_exclusion',
  'fraud',
  'chargeback',
  'kyc_fail',
  'dormancy',
  'ip_flood',
  'near_threshold_deposit',
  'manual',
] as const

export type AffiliateRejectReason = (typeof AFFILIATE_REJECT_REASONS)[number]

/**
 * Партнёр программы.
 *
 * userId — FK на players: партнёр получает РЕАЛЬНЫЙ кошелёк игрока, поэтому
 * начисление идёт через обычный WalletFacade.credit, а вывод — через общую
 * кассу. Отдельной кассы выплат в MVP нет (решение D3).
 */
export interface AffiliateEntity {
  readonly id: string
  readonly userId: string
  readonly email: string
  readonly passwordHash: string
  readonly status: AffiliateStatus
  readonly trackingCode: string
  readonly displayName: string | null
  readonly country: string | null
  readonly telegram: string | null
  readonly website: string | null
  readonly trafficSources: string[]
  readonly revshareRate: RevShareRate
  readonly payoutCurrency: string
  readonly totalEarned: string
  readonly totalPaid: string
  readonly isAgreed: boolean
  readonly agreedAt: Date | null
  readonly suspendedReason: string | null
  readonly lastClickAt: Date | null
  readonly lastLoginAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

/** Партнёр без хеша пароля — для всех внешних ответов API (DTO-маппинг).
 *  Shape объявлен в @casino/shared-types (В4), здесь только алиас имени. */
export type AffiliatePublic = AffiliateProfileRow

/** Клик по трекинг-ссылке. Содержит ТОЛЬКО хеш IP — сырой IP не сохраняется (GDPR/152-ФЗ). */
export interface AffiliateClickEntity {
  readonly id: string
  readonly affiliateId: string
  readonly landingPath: string
  readonly ipHash: string
  readonly userAgent: string | null
  readonly refererHost: string | null
  readonly geoCountry: string | null
  readonly campaignId: string | null
  readonly subId: string | null
  readonly isConverted: boolean
  readonly createdAt: Date
}

/** Привязка игрока к партнёру. Создаётся один раз и больше не меняет партнёра. */
export interface AffiliateAttributionEntity {
  readonly id: string
  readonly affiliateId: string
  readonly playerId: string
  readonly clickId: string | null
  readonly status: AffiliateAttributionStatus
  readonly qualifiedAt: Date | null
  readonly firstDepositId: string | null
  readonly firstDepositAt: Date | null
  readonly totalDeposit: string
  readonly depositCount: number
  readonly isSelfReferral: boolean
  readonly rejectReason: AffiliateRejectReason | null
  readonly createdAt: Date
}

/** Начисление RevShare. revshareRate — снимок ставки на момент расчёта. */
export interface AffiliateCommissionEntity {
  readonly id: string
  readonly affiliateId: string
  readonly playerId: string
  readonly attributionId: string | null
  readonly periodStart: Date
  readonly periodEnd: Date
  readonly currency: string
  readonly betSum: string
  readonly winSum: string
  readonly rollbackSum: string
  readonly bonusSum: string
  readonly providerFeeSum: string
  readonly ggrAmount: string
  readonly ngrAmount: string
  readonly revshareRate: RevShareRate
  readonly commissionAmount: string
  readonly status: AffiliateCommissionStatus
  readonly creditedAt: Date | null
  readonly ledgerEntryId: string | null
  readonly createdAt: Date
}

/** Проверка: атрибутирует ли партнёр трафик. Единственное место, где решается этот вопрос. */
export function canAttributeTraffic(affiliate: Pick<AffiliateEntity, 'status'>): boolean {
  return affiliate.status === 'active'
}
