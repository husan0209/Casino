import { z } from 'zod'

import { RELEASE_CRYPTO_CURRENCIES } from '../../domain/payment-currency.policy'

export const CreateCryptoDepositSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,8})?$/, 'Invalid amount format'),
  /**
   * TZ-02: enum построен на релизном наборе валют (USDT_TRC20, BTC), а не на
   * локальном списке — раньше здесь жили TON/TRX/LTC, исключённые из релиза, и
   * запрос в такой валюте проходил валидацию и уходил в NOWPayments.
   * Отклонение на границе даёт 400 VALIDATION_ERROR; домен (тот же набор) даёт
   * 422 INVALID_CURRENCY для вызывающих, минующих HTTP-слой.
   */
  currency: z.enum(RELEASE_CRYPTO_CURRENCIES),
})
export type CreateCryptoDepositDto = z.infer<typeof CreateCryptoDepositSchema>
