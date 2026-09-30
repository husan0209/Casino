/**
 * Типы admin-контрактов партнёрской программы (ТЗ ч.8 §10.3).
 *
 * Зеркалят ответы AffiliateAdminController. Суммы — строки (API_CONVENTIONS §10.1).
 */

export interface AdminAffiliateDto {
  id: string
  email: string
  status: string
  tracking_code: string
  revshare_rate: string
  total_earned: string
  created_at: string
}

export interface AdminAffiliateDetailDto {
  id: string
  email: string
  display_name: string | null
  status: string
  tracking_code: string
  revshare_rate: string
  revshare_percent: string
  total_earned: string
  total_paid: string
  suspended_reason: string | null
  is_agreed: boolean
  terms_version: string
  created_at: string
}

export interface AdminAffiliateCommissionDto {
  id: string
  affiliate_id: string
  player_id: string
  period_start: string
  currency: string
  ngr_amount: string
  revshare_rate: string
  commission_amount: string
  status: string
}

export interface AdminAffiliateAttributionDto {
  id: string
  affiliate_id: string
  player_id: string
  status: string
  total_deposit: string
  reject_reason: string | null
  is_self_referral: boolean
  created_at: string
}

export interface AdminAffiliateSettingsDto {
  settings: Record<string, string>
  revshare_percent: string
  raw: Array<{ key: string; value: string; type: string; updated_at: string }>
}

export interface AdminAffiliateOverviewDto {
  partners: { total: number; active: number; suspended: number; rejected: number }
  revenue: { total_commission: string; total_ngr: string }
}

/** Ответ ручного прогона расчёта (POST /admin/affiliate/run-daily). */
export interface RunDailyResultDto {
  date: string
  processed: number
  created: number
  credited: number
  errors: string[]
}

/** Ответ clawback (POST /admin/affiliate/clawback/:playerId). */
export interface ClawbackResultDto {
  cancelled: number
  reversed_amount: string
  insufficient_funds: Array<{ commission_id: string; amount: string; currency: string }>
}
