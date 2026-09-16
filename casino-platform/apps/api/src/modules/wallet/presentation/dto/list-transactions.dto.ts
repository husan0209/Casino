import { z } from 'zod'

import { LedgerEntryType, type Prisma } from '@casino/database'
import { type Currency, ZERO } from '@casino/shared-types'

/**
 * GAP-55 (г): запрос истории транзакций (GET /wallet/transactions).
 *
 * До валидации было двуглавое 500: мусорный `?type=`/`?currency=` уходил прямо в Prisma,
 * а `?from=вчера` давал Invalid Date. Теперь форма запроса описана здесь, значения
 * перечислений берутся из рантайма (Prisma-enum + ключи ZERO), поэтому список валют
 * и типов не может разъехаться со схемой/типами.
 *
 * `from`/`to` — дата YYYY-MM-DD; границы суток интерпретирует контроллер.
 */
const LEDGER_TYPES = Object.values(LedgerEntryType) as [
  LedgerEntryType,
  ...LedgerEntryType[],
]

/** Ключи ZERO = Record<Currency, MoneyAmount> ⇒ набор валют синхронен с типом. */
const CURRENCIES = Object.keys(ZERO) as [Currency, ...Currency[]]

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ожидается дата в формате YYYY-MM-DD')

export const ListTransactionsSchema = z
  .object({
    page: z.string().regex(/^\d{1,6}$/).optional(),
    per_page: z.string().regex(/^\d{1,4}$/).optional(),
    currency: z.enum(CURRENCIES).optional(),
    type: z.enum(LEDGER_TYPES).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .strict()

export type ListTransactionsDto = {
  page?: string | undefined
  per_page?: string | undefined
  currency?: Currency | undefined
  type?: LedgerEntryType | undefined
  from?: string | undefined
  to?: string | undefined
}

/** Строка истории проводок (контракт GET /wallet/transactions). */
export interface TransactionRow {
  id: string
  transaction_id: string
  type: LedgerEntryType
  amount: string
  currency: string
  balance_before: string
  balance_after: string
  description: string | null
  /**
   * То, что реально записано при зачислении (provider, external_id, actually_paid).
   * Курс намеренно не показывается в UI: при crypto-депозите он не фиксировался
   * (ТЗ §11 — «курс только если реально фиксировался»).
   */
  metadata: Prisma.JsonValue
  created_at: Date
  /**
   * GAP-55 (§11 «статус»): статус payment_request, к которому относится проводка
   * (заморозка/списание/разблокировка вывода). null — проводка не заявочная
   * (депозит, ставка, выигрыш) либо ссылка не записана (строки до GAP-55).
   */
  payment_status: string | null
}
