import { apiGet } from '@/lib/api'

/**
 * Ответ GET /kyc/status. Поля лимитов — ровно те, что отдаёт API (GAP-36), на
 * клиенте курсы не пересчитываются.
 *
 * Полей `deposit_limit_rub` / `total_deposited_rub` здесь больше нет: с
 * 2026-10-07 порог относится к ВЫВОДУ (решение владельца), и показывать
 * «остаток лимита пополнения» — значит обещать правило, которого нет.
 *
 * Аудит контрактов 2026-09-26: было `rejection_reason` — такого ключа API не
 * отдаёт, и причина отказа никогда не показывалась на /kyc.
 */
export interface KycStatus {
  status: string
  rejectionReason?: string | null
  documents?: string[]
  /** Порог вывода без верификации, ₽. */
  withdraw_limit_rub: string
  /** Сколько уже выведено и заморожено, ₽. */
  withdrawn_rub: string
  /** Порог минус оборот, ₽ (0, если превышен). */
  withdraw_remaining_rub: string
  /** То же число в валюте запроса — для суммы в форме вывода. */
  withdraw_remaining: string
  withdraw_currency: string
}

export function getKycStatus(currency?: string): Promise<KycStatus> {
  return apiGet<KycStatus>('/kyc/status', currency ? { currency } : undefined)
}
