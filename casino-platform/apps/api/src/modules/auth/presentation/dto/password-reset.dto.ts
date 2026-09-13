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

// GAP-52 (ТЗ ч.5 §9 «Безопасность»): смена пароля из профиля.
// Правило силы пароля — то же, что в RegisterSchema/ResetPasswordSchema.
export const ChangePasswordSchema = z
  .object({
    current_password: z.string().min(1).max(128),
    new_password: z
      .string()
      .min(8, 'Минимум 8 символов')
      .regex(/\d/, 'Пароль должен содержать минимум 1 цифру'),
  })
  .strict()
export type ChangePasswordDto = z.infer<typeof ChangePasswordSchema>
