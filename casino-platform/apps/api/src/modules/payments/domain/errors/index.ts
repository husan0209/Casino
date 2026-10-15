import { AppError } from '@casino/shared-utils'

export class KycRequiredError extends AppError {
  readonly code = 'KYC_REQUIRED'
  readonly httpStatus = 422
  constructor(m = 'KYC verification required') {
    super(m)
  }
}
export class PaymentProviderError extends AppError {
  // : string, а не литерал — иначе подкласс не сможет подставить свой код.
  readonly code: string = 'PAYMENT_PROVIDER_ERROR'
  readonly httpStatus = 502
  constructor(m = 'Payment provider error', ctx?: Record<string, unknown>) {
    super(m, ctx)
  }
}

/**
 * Отказ провайдера — это не одна «502». «Твой счёт приостановлен» и «такого
 * способа нет» требуют от игрока разных действий, а общая фраза отправляет его
 * долбить кнопку: RuKassa ведёт клиента по нашему `user_code` и после серии
 * отказов замораживает его навсегда. Поэтому у каждого отказа свой стабильный
 * код, а текст провайдера наружу по-прежнему не уходит — он в БД и в логе.
 *
 * Классифицируем по тексту, а не по коду: у RuKassa `error: 300` общий и для
 * замороженного клиента, и для неактивированного метода.
 */
export class PaymentProviderAccountFrozenError extends PaymentProviderError {
  override readonly code: string = 'PAYMENT_PROVIDER_ACCOUNT_FROZEN'
  constructor() {
    super('Payment provider suspended this account')
  }
}

export class PaymentProviderMethodUnavailableError extends PaymentProviderError {
  override readonly code: string = 'PAYMENT_PROVIDER_METHOD_UNAVAILABLE'
  constructor() {
    super('Payment provider has no such method enabled')
  }
}

export function providerRefusalError(reason: string): PaymentProviderError {
  if (/client is frozen/i.test(reason)) {
    return new PaymentProviderAccountFrozenError()
  }
  if (/method is not activated/i.test(reason)) {
    return new PaymentProviderMethodUnavailableError()
  }
  return new PaymentProviderError('Payment provider error')
}
export class AmountTooSmallError extends AppError {
  readonly code = 'AMOUNT_TOO_SMALL'
  readonly httpStatus = 422
  constructor(min: string) {
    super(`Amount too small, min ${min}`, { min })
  }
}
export class AmountTooLargeError extends AppError {
  readonly code = 'AMOUNT_TOO_LARGE'
  readonly httpStatus = 422
  constructor(max: string) {
    super(`Amount too large, max ${max}`, { max })
  }
}
export class InvalidCurrencyError extends AppError {
  readonly code = 'INVALID_CURRENCY'
  readonly httpStatus = 422
  constructor(m = 'INVALID_CURRENCY', ctx?: Record<string, unknown>) {
    super(m, ctx)
  }
}
/**
 * Реквизиты вывода не подходят сети/методу (`INVALID_DESTINATION`, 422).
 *
 * Отдельный код от `INVALID_CURRENCY`: валюта может быть релизной, а адрес —
 * чужой сети (TRC20-адрес в заявке на BTC). Отправка в такой адрес — потеря
 * средств без возврата, поэтому проверка fail-closed и до создания заявки.
 * Контекст обрезается: сообщение уходит наружу, реквизиты — чувствительные
 * данные (номер карты целиком не логируем и не возвращаем).
 */
export class InvalidDestinationError extends AppError {
  readonly code = 'INVALID_DESTINATION'
  readonly httpStatus = 422
  constructor(m = 'INVALID_DESTINATION', ctx?: Record<string, unknown>) {
    super(m, ctx)
  }
}
/**
 * Сумма заявки не разбирается как десятичное денежное значение
 * (`INVALID_AMOUNT`, 422).
 *
 * До этого `new Decimal('мусор')` бросал сырую ошибку decimal.js и клиент
 * получал 500. HTTP-слой отсекает мусор regex'ом DTO (400 VALIDATION_ERROR),
 * поэтому класс обслуживает вызывающих, минующих presentation.
 */
export class InvalidAmountError extends AppError {
  readonly code = 'INVALID_AMOUNT'
  readonly httpStatus = 422
  constructor(m = 'INVALID_AMOUNT', ctx?: Record<string, unknown>) {
    super(m, ctx)
  }
}
/** 400 сохранён от прежнего BadRequestException('NOT_FOUND') — контракт web. */
export class PaymentRequestNotFoundError extends AppError {
  readonly code = 'NOT_FOUND'
  readonly httpStatus = 400
  constructor(m = 'NOT_FOUND') {
    super(m)
  }
}
/** 403 сохранён от прежнего ForbiddenException. */
export class WithdrawalCancelForbiddenError extends AppError {
  readonly code = 'WITHDRAWAL_CANCEL_FORBIDDEN'
  readonly httpStatus = 403
  constructor(m = 'Forbidden') {
    super(m)
  }
}
