import { z } from 'zod'

// SECURITY_BASELINE.md §2.2: min 8 chars + min 1 digit.
export const RegisterSchema = z.object({
  email: z.string().email(),
  password: z
    .string()
    .min(8, 'Минимум 8 символов')
    .regex(/\d/, 'Пароль должен содержать минимум 1 цифру'),
  referral_code: z.string().optional(),
})
export type RegisterDto = z.infer<typeof RegisterSchema>
