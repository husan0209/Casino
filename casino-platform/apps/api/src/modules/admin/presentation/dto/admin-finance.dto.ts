import { z } from 'zod'

import { LedgerEntryType, PaymentProvider, PaymentStatus, PaymentType } from '@casino/database'
import { type Currency, ZERO } from '@casino/shared-types'

const amountField = z.string().regex(/^\d+(\.\d{1,8})?$/, 'Invalid amount format')

// GAP-21: финансовые операции админки (money-sensitive).
export const RejectWithdrawalSchema = z.object({
  reason: z.string().min(1).max(500),
})

export const BatchApproveSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(1000),
})

export const BatchRejectSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(1000),
  reason: z.string().min(1).max(500),
})

// POST /admin/finance/wallet/:user_id/credit и /debit
export const WalletAdjustSchema = z.object({
  amount: amountField,
  currency: z.string().min(3).max(8),
  reason: z.string().min(1).max(500),
})

export type RejectWithdrawalDto = z.infer<typeof RejectWithdrawalSchema>
export type BatchApproveDto = z.infer<typeof BatchApproveSchema>
export type BatchRejectDto = z.infer<typeof BatchRejectSchema>
export type WalletAdjustDto = z.infer<typeof WalletAdjustSchema>

/**
 * Списки кассы (UC-PAY-16/17/10/18).
 *
 * До этого фильтры собирались в контроллере и кастовались к enum'ам БД без
 * проверки: `?status=какашка` уходил в Prisma и давал 500 (`PrismaClient
 * ValidationError` → generic INTERNAL_ERROR в GlobalExceptionFilter), а не 400.
 * Значения берутся из рантайм-enum'ов `@casino/database`, поэтому список не
 * может разойтись со схемой.
 *
 * `per_page` СОХРАНЯЕТ прежнее поведение админки: потолок 200 и дефолт 50 —
 * раньше запрос сверх потолка урезался молча (`Math.min`), урезание оставили,
 * чтобы не требовать правки от существующего фронта.
 */
const LEDGER_TYPES = Object.values(LedgerEntryType) as [LedgerEntryType, ...LedgerEntryType[]]
const PAYMENT_TYPES = Object.values(PaymentType) as [PaymentType, ...PaymentType[]]
const PAYMENT_STATUSES = Object.values(PaymentStatus) as [PaymentStatus, ...PaymentStatus[]]
const PAYMENT_PROVIDERS = Object.values(PaymentProvider) as [PaymentProvider, ...PaymentProvider[]]
/** Ключи ZERO = Record<Currency, MoneyAmount> ⇒ набор валют синхронен с типом. */
const CURRENCIES = Object.keys(ZERO) as [Currency, ...Currency[]]

const userIdField = z.string().trim().min(1).max(64)

const AdminListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce
    .number()
    .int()
    .min(1)
    .default(50)
    .transform((value) => Math.min(value, 200)),
})

export const AdminTransactionsQuerySchema = AdminListQuerySchema.extend({
  user_id: userIdField.optional(),
  type: z.enum(LEDGER_TYPES).optional(),
  currency: z.enum(CURRENCIES).optional(),
})

export const AdminPaymentRequestsQuerySchema = AdminListQuerySchema.extend({
  user_id: userIdField.optional(),
  type: z.enum(PAYMENT_TYPES).optional(),
  status: z.enum(PAYMENT_STATUSES).optional(),
  provider: z.enum(PAYMENT_PROVIDERS).optional(),
})

export const AdminWithdrawalsQuerySchema = AdminListQuerySchema.extend({
  user_id: userIdField.optional(),
  status: z.enum(PAYMENT_STATUSES).optional(),
  currency: z.enum(CURRENCIES).optional(),
})

export type AdminTransactionsQueryDto = z.infer<typeof AdminTransactionsQuerySchema>
export type AdminPaymentRequestsQueryDto = z.infer<typeof AdminPaymentRequestsQuerySchema>
export type AdminWithdrawalsQueryDto = z.infer<typeof AdminWithdrawalsQuerySchema>
