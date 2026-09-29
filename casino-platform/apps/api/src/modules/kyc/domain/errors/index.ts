import { AppError } from '@casino/shared-utils'

export class KycRequiredError extends AppError {
  readonly code = 'KYC_REQUIRED'
  readonly httpStatus = 422
  constructor(msg = 'KYC verification required') {
    super(msg)
  }
}
export class KycAlreadySubmittedError extends AppError {
  readonly code = 'KYC_ALREADY_SUBMITTED'
  readonly httpStatus = 409
  constructor() {
    super('KYC already submitted')
  }
}
export class KycNotSubmittedError extends AppError {
  readonly code = 'KYC_NOT_SUBMITTED'
  readonly httpStatus = 400
  constructor() {
    // текст сохранён 1-в-1 с прежним raw new Error (G17)
    super('KYC_NOT_SUBMITTED')
  }
}
export class KycFileError extends AppError {
  readonly code = 'KYC_FILE_INVALID'
  readonly httpStatus = 400
  constructor(msg: string) {
    super(msg)
  }
}
