import { z } from 'zod'

export const ForgotPasswordSchema = z.object({
  email: z.string().email(),
})
export type ForgotPasswordDto = z.infer<typeof ForgotPasswordSchema>

export const ResetPasswordSchema = z.object({
  token: z.string().min(16).max(256),
  new_password: z
    .string()
    .min(8, 'Минимум 8 символов')
    .regex(/\d/, 'Пароль должен содержать минимум 1 цифру'),
})
export type ResetPasswordDto = z.infer<typeof ResetPasswordSchema>
