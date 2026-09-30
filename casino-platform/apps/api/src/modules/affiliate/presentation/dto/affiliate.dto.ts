/**
 * DTO и Zod-схемы партнёрской программы (ТЗ ч.8 §10).
 *
 * Валидация на входе обязательна (AI_DEVELOPMENT_RULES §6.1). Схемы используют
 * `z` из уже подключённого Zod, парсятся через общий ZodValidationPipe.
 */
import { z } from 'zod'

/** Код трекинга: 8 символов из алфавита без 0/O/1/I. */
export const TrackingCodeSchema = z
  .string()
  .trim()
  .min(4)
  .max(32)
  .regex(/^[A-Za-z0-9]+$/, 'Некорректный код партнёра')
  .transform((value) => value.toUpperCase())

/** Email: тот же формат, что у игроков, но в нижний регистр. */
export const AffiliateEmailSchema = z
  .string()
  .trim()
  .email('Некорректный email')
  .max(255)
  .transform((value) => value.toLowerCase())

/** Пароль: минимум 8 символов, как у игроков (auth: WeakPasswordError). */
export const AffiliatePasswordSchema = z
  .string()
  .min(8, 'Пароль должен быть не короче 8 символов')
  .max(128)

export const RegisterAffiliateSchema = z.object({
  email: AffiliateEmailSchema,
  password: AffiliatePasswordSchema,
  displayName: z.string().trim().max(128).optional(),
  telegram: z.string().trim().max(64).optional(),
  website: z.string().trim().url('Некорректный URL сайта').max(500).optional(),
  /** Принятие соглашения — обязательное для compliance (ТЗ ч.8 §14.1). */
  acceptTerms: z.literal(true, { message: 'Необходимо принять условия партнёрской программы' }),
})

export const LoginAffiliateSchema = z.object({
  email: AffiliateEmailSchema,
  password: z.string().min(1).max(128),
})

export const UpdateAffiliateSelfSchema = z.object({
  displayName: z.string().trim().max(128).nullable().optional(),
  telegram: z.string().trim().max(64).nullable().optional(),
  website: z.string().trim().url('Некорректный URL сайта').max(500).nullable().optional(),
})

export const UpdateAffiliatePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: AffiliatePasswordSchema,
})

/** Ставка приходит строкой: деньги-чувствительный параметр (DECIMAL, не float). */
export const RevShareRateSchema = z
  .string()
  .trim()
  .regex(/^\d*\.?\d+$/, 'Ставка должна быть числом')
  .refine((value) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
  }, 'Ставка должна быть в диапазоне 0..1')

export const CreateAffiliateAdminSchema = z.object({
  email: AffiliateEmailSchema,
  password: AffiliatePasswordSchema,
  displayName: z.string().trim().max(128).optional(),
  country: z.string().trim().length(2).toUpperCase().optional(),
  payoutCurrency: z.string().trim().min(3).max(16).default('RUB'),
  revshareRate: RevShareRateSchema.optional(),
})

export const UpdateAffiliateAdminSchema = z.object({
  status: z.enum(['active', 'suspended', 'rejected']).optional(),
  revshareRate: RevShareRateSchema.optional(),
  displayName: z.string().trim().max(128).nullable().optional(),
  country: z.string().trim().length(2).toUpperCase().nullable().optional(),
  telegram: z.string().trim().max(64).nullable().optional(),
  website: z.string().trim().url().max(500).nullable().optional(),
  payoutCurrency: z.string().trim().min(3).max(16).optional(),
  suspendedReason: z.string().trim().max(500).nullable().optional(),
  isAgreed: z.boolean().optional(),
})

export const RunDailySchema = z.object({
  /** Период в формате YYYY-MM-DD. Отсутствует = вчера. */
  date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Формат даты: YYYY-MM-DD')
    .optional(),
})

export const UpdateAffiliateSettingSchema = z.object({
  key: z.string().trim().min(3).max(128),
  value: z.string().trim().min(1).max(500),
  type: z.enum(['string', 'number', 'boolean', 'json']),
})

/** Query-параметры пагинации. */
export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce.number().int().positive().max(100).default(20),
})

export const AffiliateListQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(['active', 'suspended', 'rejected']).optional(),
  search: z.string().trim().max(128).optional(),
})

export const CommissionListQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(['pending', 'approved', 'paid', 'cancelled']).optional(),
  from: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
})

export const ClickQuerySchema = z.object({
  days: z.coerce.number().int().positive().max(365).default(30),
})

export type RegisterAffiliateDto = z.infer<typeof RegisterAffiliateSchema>
export type LoginAffiliateDto = z.infer<typeof LoginAffiliateSchema>
export type UpdateAffiliateSelfDto = z.infer<typeof UpdateAffiliateSelfSchema>
export type CreateAffiliateAdminDto = z.infer<typeof CreateAffiliateAdminSchema>
export type UpdateAffiliateAdminDto = z.infer<typeof UpdateAffiliateAdminSchema>
export type AffiliateListQueryDto = z.infer<typeof AffiliateListQuerySchema>
export type CommissionListQueryDto = z.infer<typeof CommissionListQuerySchema>
export type ClickQueryDto = z.infer<typeof ClickQuerySchema>
