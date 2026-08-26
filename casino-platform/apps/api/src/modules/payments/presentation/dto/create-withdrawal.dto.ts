import { z } from 'zod'

const amountField = z.string().regex(/^\d+(\.\d{1,8})?$/, 'Invalid amount format')

export const CreateFiatWithdrawalSchema = z.object({
  amount: amountField,
  method: z.enum(['card', 'sbp']),
  destination: z.string().min(1).max(256), // card number / SBP phone — validate further in use case
})

export const CreateCryptoWithdrawalSchema = z.object({
  amount: amountField,
  currency: z.enum(['USDT_TRC20', 'BTC', 'TON', 'TRX', 'LTC']),
  destination: z.string().min(8).max(256), // crypto address — min 8 chars sanity check
})

export type CreateFiatWithdrawalDto = z.infer<typeof CreateFiatWithdrawalSchema>
export type CreateCryptoWithdrawalDto = z.infer<typeof CreateCryptoWithdrawalSchema>
