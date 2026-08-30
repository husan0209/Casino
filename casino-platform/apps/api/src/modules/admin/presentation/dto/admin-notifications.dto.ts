import { z } from 'zod'

// GAP-21: рассылка уведомлений. Пустой/отсутствующий userIds = всем (см. хендлер),
// поэтому поле опционально с дефолтом [].
export const SendNotificationSchema = z.object({
  userIds: z.array(z.string().min(1)).max(100000).default([]),
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(2000),
  type: z.string().min(1).max(32).optional(),
})
export type SendNotificationDto = z.infer<typeof SendNotificationSchema>
