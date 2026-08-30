import { z } from 'zod'

const amountField = z.string().regex(/^\d+(\.\d{1,8})?$/, 'Invalid amount format')

// GAP-21: финансовые операции админки (money-sensitive).
export const RejectWithdrawalSchema = z.object({
  reason: z.string().min(1).max(500),
})

export const BatchApproveSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(1000),
})

export const BatchRejectSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(1000),
  reason: z.string().min(1).max(500),
})

// POST /admin/finance/wallet/:user_id/credit и /debit
export const WalletAdjustSchema = z.object({
  amount: amountField,
  currency: z.string().min(3).max(8),
  reason: z.string().min(1).max(500),
})

export type RejectWithdrawalDto = z.infer<typeof RejectWithdrawalSchema>
export type BatchApproveDto = z.infer<typeof BatchApproveSchema>
export type BatchRejectDto = z.infer<typeof BatchRejectSchema>
export type WalletAdjustDto = z.infer<typeof WalletAdjustSchema>
