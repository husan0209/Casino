/** Порты payments (решение В5: application-слой работает с infrastructure
 * только через интерфейсы + DI-токены — по образцу maintenance.ports.ts и
 * kyc/domain/repositories/kyc.repository.ts).
 *
 * Контракты повторяют публичную поверхность существующих классов infrastructure;
 * строки БД типизированы типами @casino/database (type-only импорт — без
 * рантайм-зависимости domain от infrastructure).
 */

import type {
  Prisma,
  PaymentCallback,
  PaymentProvider,
  PaymentRequest,
  PaymentStatus,
  PaymentType,
} from '@prisma/client'

/** Строка платёжки (Prisma PaymentRequest) — переэкспорт для application-слоя. */
export type { PaymentRequest }

/**
 * Строка админского списка заявок: сама заявка и email игрока. Тип ВЫВОДИТСЯ из
 * include-конфигурации запроса, а не пишется руками: развёрнутые литералы уже
 * расходились с колонками (см. комментарий в `admin-finance.controller.ts`).
 */
export type PaymentRequestAdminRow = Prisma.PaymentRequestGetPayload<{
  include: { user: { select: { email: true } } }
}>

/** Карточка заявки для админки: те же поля + колбэки провайдеров + email игрока. */
export type PaymentRequestDetailRow = Prisma.PaymentRequestGetPayload<{
  include: { callbacks: true; user: { select: { email: true } } }
}>

/**
 * Платёжные методы Rukassa (страница «Разработчикам»: lk.rukassa.io/api/v1).
 * Наш `method` уходит провайдеру только если он здесь; иначе поле не отправляем
 * и форма Rukassa показывает методы, включённые в кабинете мерчанта.
 */
export const RUKASSA_METHODS = [
  'card',
  'card_kzt',
  'card_azn',
  'skinpay',
  'crypta',
  'sbp',
  'clever',
  'sbp_kyc',
  'sbp_qr',
] as const

export type RukassaMethod = (typeof RUKASSA_METHODS)[number]

export function isRukassaMethod(value: string | undefined): value is RukassaMethod {
  return value !== undefined && (RUKASSA_METHODS as readonly string[]).includes(value)
}

/**
 * Параметры создания платежа в Rukassa (TZ part 3 §5, UC-PAY-01).
 * `orderId` — их `order_id` (тип Int): наш числовой id, а не UUID заявки.
 * `data` — JSON, который провайдер вернёт в уведомлении: по нему и находим
 * платёжку, потому что `order_id` в вебхуке приходит без нашего UUID.
 */
export interface RukassaCreatePayment {
  amount: string
  orderId: string
  data: string
  /**
   * Код плательщика на их стороне (`user_code`): под ним RuKassa держит клиента
   * и может его заморозить, поэтому это должен быть id игрока, а не общий на всех.
   */
  userCode: string
  method?: string
  currency?: string
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
  /**
   * Сколько заявок на пополнение игрок создал с `since` и не довёл до оплаты.
   *
   * Нужен суточному самолимиту фиата: RuKassa ведёт плательщика по нашему
   * `user_code` и, как подтвердил их саппорт, замораживает клиента после серии
   * неоплаченных заявок. Порог измерен на стенде 16.10: три неоплаченных счёта,
   * и на четвёртом — `403 client is frozen`. Самостоятельно разморозить клиента
   * мы не можем (API-метода нет), поэтому останавливаться надо ДО их порога.
   */
  countUnfinishedDeposits(args: {
    userId: string
    provider: PaymentProvider
    since: Date
  }): Promise<number>
  listUser(args: {
    userId: string
    type?: 'deposit' | 'withdrawal'
    page: number
    perPage: number
  }): Promise<[PaymentRequest[], number]>
  /**
   * Админский список заявок (ТЗ ч.3 UC-PAY-17 и UC-PAY-10) с фильтрами и
   * пагинацией.
   *
   * Запрос живёт здесь, а не в контроллере: `payment_requests` принадлежит
   * payments, а presentation не имеет права ходить в БД (гард G27). До этого
   * `admin-finance.controller.ts` собирал `where` сам и кастовал строки query
   * к enum'ам без валидации.
   *
   * Возвращает пару `[rows, total]` — как `listUser`, чтобы счётчик для мета
   * не требовал второго вызова на стороне потребителя.
   */
  listAdmin(args: {
    userId?: string | undefined
    type?: PaymentType | undefined
    status?: PaymentStatus | undefined
    provider?: PaymentProvider | undefined
    currency?: string | undefined
    page: number
    perPage: number
  }): Promise<[PaymentRequestAdminRow[], number]>
  /** Карточка заявки с колбэками провайдера и email игрока (UC-PAY-18). */
  findDetail(id: string): Promise<PaymentRequestDetailRow | null>
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
  /** Уведомление об оплате: подпись в заголовке `signature`, ключ — API-токен. */
  verifyCallback(headers: Record<string, string>, body: Record<string, unknown>): boolean
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
