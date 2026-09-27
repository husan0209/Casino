import { apiGet } from '@/lib/api'

/**
 * Ответ GET /kyc/status (GAP-36: лимитные поля из API, не пересчёт на клиенте).
 * Статусные поля — camelCase ровно как их отдаёт GetKycStatusUseCase (spread
 * строки репозитория: {status, submittedAt, rejectionReason, documents}).
 * Аудит контрактов 2026-09-26: было rejection_reason — такого ключа API не
 * отдаёт, и причина отказа никогда не показывалась на /kyc.
 */
export interface KycStatus {
  status: string
  rejectionReason?: string | null
  documents?: string[]
  deposit_limit_rub: string
  total_deposited_rub: string
  limit_remaining: string
  limit_currency: string
}

export function getKycStatus(currency?: string): Promise<KycStatus> {
  return apiGet<KycStatus>('/kyc/status', currency ? { currency } : undefined)
}
