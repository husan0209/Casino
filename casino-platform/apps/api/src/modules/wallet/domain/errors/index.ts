import { AppError } from '@casino/shared-utils'
import type { MoneyAmount } from '@casino/shared-types'
export class InsufficientFundsError extends AppError {
  readonly code = 'INSUFFICIENT_FUNDS'; readonly httpStatus = 422
  constructor(public readonly required: MoneyAmount, public readonly available: MoneyAmount) {
    super(`Insufficient funds: required ${required}, available ${available}`, { required, available })
  }
}
export class WalletNotFoundError extends AppError {
  readonly code = 'WALLET_NOT_FOUND'; readonly httpStatus = 404
  constructor(public readonly userId: string, public readonly currency: string) { super(`Wallet not found for user ${userId} in ${currency}`) }
}
export class DuplicateRequestError extends AppError {
  readonly code = 'DUPLICATE_REQUEST'; readonly httpStatus = 409
  constructor(public readonly idempotencyKey: string) { super(`Duplicate request: ${idempotencyKey}`) }
}
export class OptimisticLockError extends AppError {
  readonly code = 'OPTIMISTIC_LOCK_CONFLICT'; readonly httpStatus = 500
  constructor() { super('Optimistic lock conflict, retry needed') }
}
