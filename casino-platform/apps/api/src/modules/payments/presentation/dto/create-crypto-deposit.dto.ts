import { z } from 'zod'

export const CreateCryptoDepositSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,8})?$/, 'Invalid amount format'),
  currency: z.enum(['USDT_TRC20', 'BTC', 'TON', 'TRX', 'LTC']),
})
export type CreateCryptoDepositDto = z.infer<typeof CreateCryptoDepositSchema>
