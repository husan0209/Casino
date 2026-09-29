import { AppError } from '@casino/shared-utils'

/** Волна 3в (G17): raw Error maintenance-модуля → AppError (тексты 1-в-1). */
export class UnknownMaintenanceJobError extends AppError {
  readonly code = 'UNKNOWN_MAINTENANCE_JOB'
  readonly httpStatus = 500
  constructor(name: string) {
    super(`Unknown maintenance job: ${name}`)
  }
}
export class PaymentRequestNotPendingError extends AppError {
  readonly code = 'PAYMENT_REQUEST_NOT_PENDING'
  readonly httpStatus = 409
  constructor(id: string) {
    super(`payment_request ${id} is not pending anymore`)
  }
}
