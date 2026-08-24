import { AppError } from '@casino/shared-utils'

export class PaymentMethodUnavailableError extends AppError {
  readonly code = 'PAYMENT_METHOD_UNAVAILABLE'
  readonly httpStatus = 422
  constructor() {
    super('Payment method unavailable for this currency and region')
  }
}
