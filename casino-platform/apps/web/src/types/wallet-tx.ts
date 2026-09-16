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
  /** provider/external_id/locked_amount — что реально записано при проводке (GAP-55). */
  metadata: unknown
  /** GAP-55 (§11): статус заявки для заморозки/списания проводок вывода; null — не заявочная строка. */
  payment_status: string | null
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
