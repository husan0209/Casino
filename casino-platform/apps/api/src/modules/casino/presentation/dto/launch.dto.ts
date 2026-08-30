import { z } from 'zod'

// GAP-21: POST /casino/games/:slug/launch и /demo — оба читают один и тот же
// необязательный набор полей.
export const LaunchGameSchema = z.object({
  currency: z.string().min(3).max(8).optional(),
  return_url: z.string().max(2048).optional(),
})
export type LaunchGameDto = z.infer<typeof LaunchGameSchema>
