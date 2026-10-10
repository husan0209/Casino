import { z } from 'zod'

// GAP-21: вход через Google OAuth — code обязателен, остальное опционально.
// redirect_uri валидируется в use-case по allowlist, здесь только тип/длина.
export const GoogleLoginSchema = z.object({
  code: z.string().min(1),
  redirect_uri: z.string().max(2048).optional(),
  state: z.string().max(512).optional(),
  referral_code: z.string().max(32).optional(),
})

// GAP-21: Telegram Login Widget — плоский объект строк; hash/id/auth_date
// обязательны (их проверяет крипто-верификация в use-case). passthrough —
// остальные поля провайдера (first_name, username, lang, photo_url…) не режем.
export const TelegramLoginSchema = z
  .object({
    id: z.string(),
    auth_date: z.string(),
    hash: z.string().min(1),
  })
  .passthrough()

// GAP-75: Telegram Mini App. Клиент присылает СЫРУЮ строку
// window.Telegram.WebApp.initData, а не набор полей: подпись считается от
// точных байт Telegram, и любой пересобранный клиентом JSON (порядок ключей,
// экранирование вложенного `user`) ломает её на живом устройстве. .strict():
// лишние ключи в теле — признак подделки, а не вариант провайдера.
export const TelegramWebAppLoginSchema = z
  .object({
    init_data: z.string().min(24).max(8192),
    referral_code: z.string().max(32).optional(),
  })
  .strict()

export type GoogleLoginDto = z.infer<typeof GoogleLoginSchema>
export type TelegramLoginDto = z.infer<typeof TelegramLoginSchema>
export type TelegramWebAppLoginDto = z.infer<typeof TelegramWebAppLoginSchema>
