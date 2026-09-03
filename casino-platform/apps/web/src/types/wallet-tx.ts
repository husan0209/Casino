/**
 * DTO кошелька (контракт GET /wallet/*).
 */

/** Строка транзакции ledger (GET /wallet/transactions). */
export interface WalletTxDto {
  id: string
  transaction_id: string
  type: string
  amount: string
  currency: string
  balance_before: string
  balance_after: string
  description: string | null
  created_at: string
}

/** Ответ GET /wallet/transactions. */
export interface WalletTxListDto {
  data: WalletTxDto[]
  meta: {
    page: number
    per_page: number
    total: number
    total_pages: number
  }
}
