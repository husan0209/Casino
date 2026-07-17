import { z } from 'zod'
export const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  referral_code: z.string().optional(),
})
export type RegisterDto = z.infer<typeof RegisterSchema>
