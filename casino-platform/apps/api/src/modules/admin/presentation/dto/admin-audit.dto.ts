import { z } from 'zod'

import { ActorType } from '@casino/database'

/**
 * Список журнала аудита (`GET /admin/audit-logs`, ТЗ ч.6 §«Audit trail»).
 *
 * До валидации `?actor_type` кастовался к enum'у схемы и уходил прямо в Prisma:
 * мусорное значение давало `PrismaClientValidationError`, а
 * `GlobalExceptionFilter` превращает не-HttpException в generic 500 — то есть
 * опечатка в фильтре выглядела как упавший сервер. Значения берутся из
 * рантайм-enum'а `ActorType`, поэтому список не может разойтись со схемой.
 *
 * Пагинация сохраняет прежнее поведение админки: дефолт 50, потолок 200
 * (сверх потолка урезается молча — правка фронта не требуется).
 */
const ACTOR_TYPES = Object.values(ActorType) as [ActorType, ...ActorType[]]

export const AuditListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce
    .number()
    .int()
    .min(1)
    .default(50)
    .transform((value) => Math.min(value, 200)),
  actor_type: z.enum(ACTOR_TYPES).optional(),
  actor_id: z.string().trim().min(1).max(64).optional(),
  action: z.string().trim().min(1).max(128).optional(),
  target_type: z.string().trim().min(1).max(64).optional(),
})

export type AuditListQueryDto = z.infer<typeof AuditListQuerySchema>
