import { z } from 'zod'

export const CreateFiatDepositSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d+)?$/, 'Invalid amount format'),
  currency: z.string().min(2).max(16),
  method: z.string().min(1).max(64),
})

export type CreateFiatDepositDto = z.infer<typeof CreateFiatDepositSchema>
