import { z } from 'zod'

// GAP-21: вход через Google OAuth — code обязателен, остальное опционально.
// redirect_uri валидируется в use-case по allowlist, здесь только тип/длина.
export const GoogleLoginSchema = z.object({
  code: z.string().min(1),
  redirect_uri: z.string().max(2048).optional(),
  state: z.string().max(512).optional(),
  referral_code: z.string().max(32).optional(),
})

// GAP-21: Telegram WebApp initData — плоский объект строк; hash/id/auth_date
// обязательны (их проверяет крипто-верификация в use-case). passthrough —
// остальные поля провайдера (first_name, username, lang, photo_url…) не режем.
export const TelegramLoginSchema = z
  .object({
    id: z.string(),
    auth_date: z.string(),
    hash: z.string().min(1),
  })
  .passthrough()

export type GoogleLoginDto = z.infer<typeof GoogleLoginSchema>
export type TelegramLoginDto = z.infer<typeof TelegramLoginSchema>
