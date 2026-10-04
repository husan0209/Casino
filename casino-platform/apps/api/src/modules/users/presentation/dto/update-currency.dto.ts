import { z } from 'zod'

import { SUPPORTED_CURRENCIES } from '@casino/shared-config'

/**
 * Предпочтение валюты — только из набора платформы (`CURRENCY_LIMITS`), а не
 * «любые 2–16 символов». Прежняя граница записывала в `currency_preference` что
 * угодно (`'xx'`, `'USD '`, `'🐸🐸'`), и это значение потом читается гео-контекстом
 * и подставляется в форматирование сумм и в заявки депозита: вместо стабильного
 * отказа пользователь получал кошелёк в несуществующей валюте.
 */
export const UpdateCurrencySchema = z.object({
  currency: z.enum(SUPPORTED_CURRENCIES),
})

export type UpdateCurrencyDto = z.infer<typeof UpdateCurrencySchema>
