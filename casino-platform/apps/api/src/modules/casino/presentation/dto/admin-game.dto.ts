import { z } from 'zod'

// GAP-21: PATCH /casino-admin/games/:id — частичное обновление, все поля опц.
// Принимает и snake_case, и isPopular (исторически оба) — сохраняем как есть.
export const UpdateGameSchema = z.object({
  name_ru: z.string().min(1).max(256).optional(),
  is_new: z.boolean().optional(),
  is_popular: z.boolean().optional(),
  isPopular: z.boolean().optional(),
  sort_order: z.number().int().optional(),
  tags: z.array(z.string().min(1).max(64)).max(100).optional(),
  /**
   * Целевой возврат в процентах: `rtp` — игра на деньги, `rtp_demo` — демо.
   * Сервер собирает под число комплект таблиц, поэтому фактический возврат
   * может отличаться на сотые доли процента — это ограничение отображаемых
   * множителей, а не скрытая надбавка.
   */
  rtp: z.number().min(1).max(500).nullable().optional(),
  rtp_demo: z.number().min(1).max(500).nullable().optional(),
})
export type UpdateGameDto = z.infer<typeof UpdateGameSchema>
