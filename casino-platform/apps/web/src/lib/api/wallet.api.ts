import { apiGet, apiPatch, apiPost } from '@/lib/api'
import type { WalletBalance } from '@/types/wallet'

export function fetchBalances(): Promise<WalletBalance[]> {
  return apiGet<WalletBalance[]>('/wallet/balances')
}

export function setActiveCurrency(currency: string): Promise<{ currency_preference: string }> {
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

/**
 * Заявка на крипто-пополнение (ТЗ ч.5.1 §4.9 «DepositSheet (крипта)»). Бэк
 * (`POST /payments/deposit/crypto`, payments.controller.ts:62) возвращает адрес и
 * дедлайн — редиректа на платёжку тут нет, игрок отправляет сам, поэтому адрес
 * нужно показать и потом опрашивать статус.
 */
export interface CryptoDepositTicket {
  payment_request_id: string
  pay_address: string
  pay_amount: string
  pay_currency: string
  expires_at: string
}

export function createCryptoDeposit(input: {
  amount: string
  currency: string
}): Promise<CryptoDepositTicket> {
  return apiPost<CryptoDepositTicket>('/payments/deposit/crypto', input)
}

export function pollDepositStatus(
  id: string,
): Promise<{ id: string; status: string; currency: string; amount: string }> {
  return apiGet<{ id: string; status: string; currency: string; amount: string }>(
    `/payments/deposit/${id}/status`,
  )
}

/**
 * GAP-55 (з): заявка на вывод. destination — СТРОКА (CreateFiatWithdrawalSchema /
 * CreateCryptoWithdrawalSchema): старая страница /withdraw слала объект и ловила 422.
 */
export function createFiatWithdrawal(input: {
  amount: string
  method: 'card' | 'sbp'
  destination: string
}): Promise<{ payment_request_id: string }> {
  return apiPost<{ payment_request_id: string }>('/payments/withdrawal/fiat', input)
}

export function createCryptoWithdrawal(input: {
  amount: string
  currency: string
  destination: string
}): Promise<{ payment_request_id: string }> {
  return apiPost<{ payment_request_id: string }>('/payments/withdrawal/crypto', input)
}
