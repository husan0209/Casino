/**
 * Публичная read-модель партнёра — форма ответов API партнёрского кабинета и
 * admin-контура.
 *
 * В4: row-типы ответов API живут в shared-types. Сюда входит НЕ весь доменный
 * объект, а только его наружная часть: `passwordHash` отсутствует намеренно,
 * поэтому тип нельзя использовать там, где нужен полный `AffiliateEntity`
 * (домен, репозиторий, антифрод-проверки).
 *
 * Ставка revshare и суммы — строки: это деньги-зависимые значения
 * (AI_DEVELOPMENT_RULES §1), number для них запрещён.
 */

/** Статус партнёра. Только `active` атрибутирует трафик (ТЗ ч.8 §7.2 п.3). */
export type AffiliateStatus = 'active' | 'suspended' | 'rejected'

export interface AffiliateProfileRow {
  id: string
  userId: string
  email: string
  status: AffiliateStatus
  trackingCode: string
  displayName: string | null
  country: string | null
  telegram: string | null
  website: string | null
  trafficSources: string[]
  /** Ставка RevShare как нормализованная decimal-строка ("0.2000"). */
  revshareRate: string
  payoutCurrency: string
  totalEarned: string
  totalPaid: string
  isAgreed: boolean
  agreedAt: Date | null
  suspendedReason: string | null
  lastClickAt: Date | null
  lastLoginAt: Date | null
  createdAt: Date
  updatedAt: Date
}
