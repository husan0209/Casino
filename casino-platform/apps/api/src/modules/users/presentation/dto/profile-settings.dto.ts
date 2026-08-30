import { z } from 'zod'

// GAP-21: PATCH /users/me/profile — все поля опциональны; неизвестные ключи
// отбрасываются (z.object по умолчанию вырезает → защита от mass-assignment).
export const UpdateProfileSchema = z.object({
  first_name: z.string().min(1).max(64).optional(),
  last_name: z.string().min(1).max(64).optional(),
  date_of_birth: z.string().min(1).max(32).optional(),
  country: z.string().min(2).max(64).optional(),
  city: z.string().min(1).max(64).optional(),
})

// PATCH /users/me/settings
export const UpdateSettingsSchema = z.object({
  language: z.string().max(8).optional(),
  notifications_email: z.boolean().optional(),
  notifications_sms: z.boolean().optional(),
  notifications_push: z.boolean().optional(),
  two_factor_enabled: z.boolean().optional(),
})

// POST /users/me/self-exclude — 0 = перманентно; контроллер дефолтит на 24,
// поэтому поле опционально, но если пришло — это целое >= 0.
export const SelfExcludeSchema = z.object({
  period_hours: z.number().int().min(0).optional(),
})

export type UpdateProfileDto = z.infer<typeof UpdateProfileSchema>
export type UpdateSettingsDto = z.infer<typeof UpdateSettingsSchema>
export type SelfExcludeDto = z.infer<typeof SelfExcludeSchema>
