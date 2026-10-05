import { z } from 'zod'

/**
 * Повторный акцепт условий после существенных изменений (GAP-73, Terms §21).
 * Версия передаётся клиентом и сверяется с серверным реестром — та же схема,
 * что при регистрации: записывать надо то, что игрок действительно видел.
 */
export const AcceptTermsSchema = z.object({
  terms_version: z
    .string()
    .min(1, 'Нужна версия условий')
    .max(16, 'Некорректная версия условий')
    .refine((version) => version.trim().length > 0, 'Некорректная версия условий'),
})
export type AcceptTermsDto = z.infer<typeof AcceptTermsSchema>
