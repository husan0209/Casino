import { z } from 'zod'

// GAP-55 (ж): captcha_token обязателен, когда CAPTCHA_REQUIRED уже выдан
// (после CAPTCHA_AFTER_FAILED_ATTEMPTS неудач); в схеме он optional —
// требование выносит use-case, иначе сломался бы обычный вход.
export const LoginSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(1),
    captcha_token: z.string().max(800).optional(),
  })
  .strict()
export type LoginDto = z.infer<typeof LoginSchema>
