import { AppError } from '@casino/shared-utils'

export class KycRequiredError extends AppError {
  readonly code = 'KYC_REQUIRED'
  readonly httpStatus = 422
  constructor(m = 'KYC verification required') {
    super(m)
  }
}
export class PaymentProviderError extends AppError {
  readonly code = 'PAYMENT_PROVIDER_ERROR'
  readonly httpStatus = 502
  constructor(m = 'Payment provider error', ctx?: Record<string, unknown>) {
    super(m, ctx)
  }
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
