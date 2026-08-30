import { z } from 'zod'

// GAP-21: upsert системной настройки. type опционален (хендлер дефолтит 'string').
export const UpsertSettingSchema = z.object({
  key: z.string().min(1).max(128),
  value: z.string().max(100000),
  type: z.string().min(1).max(32).optional(),
})

// POST /admin/settings/email-templates
export const EmailTemplateSchema = z.object({
  name: z.string().min(1).max(128),
  subject: z.string().min(1).max(500),
  htmlBody: z.string().min(1).max(200000),
})

export type UpsertSettingDto = z.infer<typeof UpsertSettingSchema>
export type EmailTemplateDto = z.infer<typeof EmailTemplateSchema>
