import { z } from 'zod'

import { type Currency, ZERO } from '@casino/shared-types'

/**
 * Валютная сетка платформы — из общего реестра `ZERO`. Прежний `max(8)` молча
 * отрезал `USDT_TRC20` (11 символов): лаунч игры в основной крипто-валюте
 * падал на валидации до всякой проверки прав.
 */
const CURRENCIES = Object.keys(ZERO) as [Currency, ...Currency[]]

// GAP-21: POST /casino/games/:slug/launch и /demo — оба читают один и тот же
// необязательный набор полей.
export const LaunchGameSchema = z.object({
  currency: z.enum(CURRENCIES).optional(),
  return_url: z.string().max(2048).optional(),
})
export type LaunchGameDto = z.infer<typeof LaunchGameSchema>
