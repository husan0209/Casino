import { z } from 'zod'

// SECURITY_BASELINE.md §2.2: min 8 chars + min 1 digit.
export const RegisterSchema = z.object({
  email: z.string().email(),
  password: z
    .string()
    .min(8, 'Минимум 8 символов')
    .regex(/\d/, 'Пароль должен содержать минимум 1 цифру'),
  referral_code: z.string().optional(),
  // GAP-71 (Terms §4): акцепт — активное действие, а не следствие регистрации.
  // z.literal(true) означает, что и «нет поля», и «галочка снята» дают отказ на
  // валидации: сервер не может создать игрока без согласия.
  accept_terms: z.literal(true, { errorMap: () => ({ message: 'Нужно принять условия и подтвердить 18+' }) }),
  // Версия условий, которую игрок видел. Use-case сверяет её с реестром
  // LEGAL_DOCUMENT_VERSIONS и отказывает устаревшему клиенту, вместо того чтобы
  // записать в журнал версию, которую тот сам придумал.
  terms_version: z.string().min(1).max(16),
})
export type RegisterDto = z.infer<typeof RegisterSchema>
