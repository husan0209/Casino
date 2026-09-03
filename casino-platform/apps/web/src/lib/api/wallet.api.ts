import { apiGet, apiPatch, apiPost } from '@/lib/api'
import type { WalletBalance } from '@/types/wallet'

export function fetchBalances(): Promise<WalletBalance[]> {
  return apiGet<WalletBalance[]>('/wallet/balances')
}

export function setActiveCurrency(
  currency: string,
): Promise<{ currency_preference: string }> {
  return apiPatch<{ currency_preference: string }>('/users/me/currency', { currency })
}

export function createFiatDeposit(input: {
  amount: string
  currency: string
  method: string
}): Promise<{ payment_request_id: string; payment_url: string }> {
  return apiPost<{ payment_request_id: string; payment_url: string }>(
    '/payments/deposit/fiat',
    input,
  )
}

export function pollDepositStatus(
  id: string,
): Promise<{ id: string; status: string; currency: string; amount: string }> {
  return apiGet<{ id: string; status: string; currency: string; amount: string }>(
    `/payments/deposit/${id}/status`,
  )
}
