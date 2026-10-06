import { z } from 'zod'

import {
  MONEY_AMOUNT_PATTERN,
  RELEASE_CRYPTO_CURRENCIES,
} from '../../domain/payment-currency.policy'

const amountField = z.string().regex(MONEY_AMOUNT_PATTERN, 'Invalid amount format')

export const CreateFiatWithdrawalSchema = z.object({
  amount: amountField,
  method: z.enum(['card', 'sbp']),
  destination: z.string().min(1).max(256), // card number / SBP phone — validate further in use case
})

/**
 * Валюта вывода — тот же релизный набор, что и у депозита
 * (`RELEASE_CRYPTO_CURRENCIES`, TZ-02). Прежде здесь был собственный список с
 * `TON`/`TRX`/`LTC`: заявка на вывод в сеть, исключённую из релиза, создавалась
 * и уходила в ручной процессинг, где её никто не исполняет.
 */
export const CreateCryptoWithdrawalSchema = z.object({
  amount: amountField,
  currency: z.enum(RELEASE_CRYPTO_CURRENCIES),
  destination: z.string().min(8).max(256), // форм-пригодность адреса сети проверяет домен
})

export type CreateFiatWithdrawalDto = z.infer<typeof CreateFiatWithdrawalSchema>
export type CreateCryptoWithdrawalDto = z.infer<typeof CreateCryptoWithdrawalSchema>
