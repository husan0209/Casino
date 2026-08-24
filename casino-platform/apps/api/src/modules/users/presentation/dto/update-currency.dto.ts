import { z } from 'zod'

export const UpdateCurrencySchema = z.object({
  currency: z.string().min(2).max(16),
})

export type UpdateCurrencyDto = z.infer<typeof UpdateCurrencySchema>
