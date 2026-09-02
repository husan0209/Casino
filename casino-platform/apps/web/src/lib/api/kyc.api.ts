import { apiGet } from '@/lib/api'

/** Ответ GET /kyc/status (GAP-36: лимитные поля из API, не пересчёт на клиенте) */
export interface KycStatus {
  status: string
  rejection_reason?: string | null
  documents?: string[]
  deposit_limit_rub: string
  total_deposited_rub: string
  limit_remaining: string
  limit_currency: string
}

export function getKycStatus(currency?: string): Promise<KycStatus> {
  return apiGet<KycStatus>('/kyc/status', currency ? { currency } : undefined)
}
