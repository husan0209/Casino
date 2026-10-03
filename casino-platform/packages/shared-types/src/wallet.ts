import type { MoneyAmount } from './money'

/**
 * Итог денежной проводки кошелька (credit/debit/lock/unlock/confirm) — read-модель.
 * В4: row-типы ответов API живут в shared-types, а не в домене модуля.
 * balanceBefore/balanceAfter — деньги, поэтому MoneyAmount (= string), а не
 * number (AI_DEVELOPMENT_RULES §1, гард G20).
 */
export interface CreditResult {
  balanceBefore: MoneyAmount
  balanceAfter: MoneyAmount
  ledgerEntryId: string
  duplicate: boolean
}
