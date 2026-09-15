import { z } from 'zod'

import { type Currency, ZERO } from '@casino/shared-types'

/**
 * GAP-55 (д): запрос истории ставок (GET /casino/history), ТЗ ч.5 §12 —
 * фильтры игра / провайдер / период / валюта.
 *
 * Дата принимается строго YYYY-MM-DD: кривая строка раньше уходила в Prisma как
 * Invalid Date и роняла запрос в 500. Перечисления не дублируются literal'ами:
 * валюты — ключи ZERO (Record<Currency, …> ⇒ синхронно с типом).
 */
const CURRENCIES = Object.keys(ZERO) as [Currency, ...Currency[]]

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ожидается дата в формате YYYY-MM-DD')

export const ListHistorySchema = z
  .object({
    page: z.string().regex(/^\d{1,6}$/).optional(),
    per_page: z.string().regex(/^\d{1,4}$/).optional(),
    game_id: z.string().uuid().optional(),
    provider: z
      .string()
      .regex(/^[a-z0-9][a-z0-9_-]{1,31}$/)
      .optional(),
    currency: z.enum(CURRENCIES).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .strict()

export type ListHistoryDto = {
  page?: string | undefined
  per_page?: string | undefined
  game_id?: string | undefined
  provider?: string | undefined
  currency?: Currency | undefined
  from?: string | undefined
  to?: string | undefined
}
