/**
 * Типы контракта партнёрской программы (ТЗ ч.8 §10, §12).
 *
 * Симметричны ответам admin-контроллера: поля в snake_case, ВСЕ суммы — строки
 * (API_CONVENTIONS §10.1 — деньги никогда не приходят числом).
 */

/** Публичные условия программы (GET /affiliate/program). */
export interface AffiliateProgramDto {
  revshare_rate: string
  cookie_days: number
  terms_version: string
  enabled: boolean
}

/** Ответ регистрации/входа — партнёрский токен (aud=affiliate), НЕ игровой. */
export interface AffiliateAuthDto {
  affiliate_id: string
  tracking_code: string
  tracking_url: string
  revshare_rate: string
  access_token: string
  message?: string
  status?: string
}

/** Профиль партнёра (GET /affiliate/me). */
export interface AffiliateMeDto {
  affiliate_id: string
  email: string
  display_name: string | null
  status: string
  tracking_code: string
  tracking_url: string
  revshare_rate: string
  revshare_percent: string
  payout_currency: string
  total_earned: string
  balance: { RUB: string; USDT_TRC20: string }
  terms_version: string
  is_agreed: boolean
}

/** Дашборд (GET /affiliate/dashboard). */
export interface AffiliateDashboardDto {
  period_days: number
  clicks: { total: number; converted: number; conversion_rate: string }
  players: { total: number }
  totals: { total_commission: string; total_ngr: string; total_ggr: string }
  settings: { revshare_rate: string; revshare_percent: string; cookie_days: number }
}

/** Начисление с полной разбивкой NGR — партнёр должен видеть, из чего сложилась комиссия. */
export interface AffiliateCommissionDto {
  id: string
  period_start: string
  period_end: string
  currency: string
  bet_sum: string
  win_sum: string
  rollback_sum: string
  bonus_sum: string
  provider_fee_sum: string
  ggr_amount: string
  ngr_amount: string
  revshare_rate: string
  commission_amount: string
  status: string
  credited_at: string | null
}

export interface AffiliateListDto<T> {
  data: T[]
  meta: { page?: number; perPage?: number; total: number }
}

/** Приведённый игрок. */
export interface AffiliatePlayerDto {
  player_id: string
  status: string
  total_deposit: string
  deposit_count: number
  first_deposit_at: string | null
  reject_reason: string | null
  created_at: string
}

/** Промо-ссылки (GET /affiliate/links). */
export interface AffiliateLinksDto {
  tracking_url: string
  cookie_days: number
  examples: Array<{ name: string; url: string }>
}

// ─── Admin ──────────────────────────────────────────────────────────────────

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
