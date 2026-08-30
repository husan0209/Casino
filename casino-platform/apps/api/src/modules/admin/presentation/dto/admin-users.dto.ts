import { z } from 'zod'

// GAP-21: блокировка пользователя админом (причина опциональна).
export const BlockUserSchema = z.object({
  reason: z.string().max(500).optional(),
})
export type BlockUserDto = z.infer<typeof BlockUserSchema>
