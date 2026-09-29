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
  constructor(m = 'INVALID_CURRENCY') {
    super(m)
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
