/** Порты payments (решение В5: application-слой работает с infrastructure
 * только через интерфейсы + DI-токены — по образцу maintenance.ports.ts и
 * kyc/domain/repositories/kyc.repository.ts).
 *
 * Контракты повторяют публичную поверхность существующих классов infrastructure;
 * строки БД типизированы типами @casino/database (type-only импорт — без
 * рантайм-зависимости domain от infrastructure).
 */

import type { Prisma, PaymentCallback, PaymentRequest, PaymentStatus } from '@prisma/client'

/** Строка платёжки (Prisma PaymentRequest) — переэкспорт для application-слоя. */
export type { PaymentRequest }

/** Параметры создания платежа в Rukassa (TZ part 3 §5, UC-PAY-01). */
export interface RukassaCreatePayment {
  amount: string
  orderId: string
  method?: string
  webhookUrl: string
  successUrl: string
  failUrl: string
}

/** Доступ к платёжкам и коллбэкам (Prisma payment_request / payment_callback). */
export interface IPaymentRequestRepository {
  create(data: Prisma.PaymentRequestUncheckedCreateInput): Promise<PaymentRequest>
  findById(id: string): Promise<PaymentRequest | null>
  findByExternalId(externalId: string, provider: string): Promise<PaymentRequest | null>
  updateStatus(
    id: string,
    status: PaymentStatus,
    extra?: {
      completedAt?: Date | undefined
      externalStatus?: string | undefined
      errorMessage?: string | undefined
      externalId?: string | undefined
      paymentUrl?: string | undefined
      /**
       * RUB, который реально зачислен (GAP-72). Нужен крипто-депозиту: заявка
       * хранит оценку на интенте, а провайдер платит `actually_paid`, — без
       * этого `amount_rub` отстаёт от кошелька, и агрегат лимита без KYC
       * недоучитывает пополнение.
       */
      amountRub?: string | undefined
    },
  ): Promise<PaymentRequest>
  listUser(args: {
    userId: string
    type?: 'deposit' | 'withdrawal'
    page: number
    perPage: number
  }): Promise<[PaymentRequest[], number]>
  /**
   * Условное истечение заявки: `pending → expired`, только если заявка ещё
   * pending. Нужна cron-задаче истечения депозитов (maintenance), но SQL живёт
   * здесь: `payment_requests` принадлежит payments (MODEL_OWNERS, гард G24).
   *
   * Условие — в `where`, а не проверкой читателя: между SELECT и UPDATE платёж
   * может завершиться вебхуком, и тогда истечение затёрло бы completed-статус.
   * Возвращает число обновлённых строк; «что делать с нулём» решает вызывающий,
   * поэтому исключения здесь нет.
   */
  expireIfPending(id: string): Promise<number>
  saveCallback(data: {
    provider: string
    externalId?: string
    paymentRequestId?: string
    rawHeaders: Record<string, string>
    rawBody: string
    ipAddress?: string
  }): Promise<PaymentCallback>
  markCallbackProcessed(id: string, result?: string): Promise<PaymentCallback>
}

/** Rukassa PSP-клиент (TZ part 3 §5): создание платежа, статус, подпись вебхука. */
export interface IRukassaClient {
  createPayment(params: RukassaCreatePayment): Promise<{ paymentId: string; paymentUrl: string }>
  getPaymentStatus(paymentId: string): Promise<{ status: string; amount: string }>
  verifyCallback(headers: Record<string, string>, rawBody: unknown): boolean
}

/** NOWPayments PSP-клиент (TZ part 3 §6): крипто-платежи, курс, IPN-подпись. */
export interface INowPaymentsClient {
  mapCurrency(ours: string): string
  createPayment(params: {
    priceAmount: string
    priceCurrency: string
    payCurrency: string
    orderId: string
    ipnCallbackUrl: string
  }): Promise<{
    paymentId: string
    payAddress: string
    payAmount: string
    payCurrency: string
    expirationEstimateDate: string
  }>
  getPaymentStatus(
    paymentId: string,
  ): Promise<{ paymentStatus: string; actuallyPaid: string; outcomeAmount: string }>
  estimate(params: {
    amount: string
    currencyFrom: string
    currencyTo: string
  }): Promise<{ estimatedAmount: string; source: string } | null>
  getEstimatePrice(params: {
    amount: string
    currencyFrom: string
    currencyTo: string
  }): Promise<{ estimatedAmount: string }>
  verifyIPN(rawBody: string, signature: string): boolean
}

/** DI-токены портов payments для Nest. */
export const PAYMENT_REQUEST_REPOSITORY = Symbol('PAYMENT_REQUEST_REPOSITORY')
export const RUKASSA_CLIENT = Symbol('RUKASSA_CLIENT')
export const NOWPAYMENTS_CLIENT = Symbol('NOWPAYMENTS_CLIENT')
