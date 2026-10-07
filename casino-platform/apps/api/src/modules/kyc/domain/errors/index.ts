import { AppError } from '@casino/shared-utils'

export class KycRequiredError extends AppError {
  // Тип — string (не литерал), чтобы наследник мог отдать другой стабильный код;
  // значение для KYC_REQUIRED не меняется.
  readonly code: string = 'KYC_REQUIRED'
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
/**
 * Fail-closed для карточки модератора (GAP: `catch(() => '0')` в kyc-admin.service).
 * Сумма депозитов — основание для выпуска средств и для решения по KYC, поэтому
 * отказ чтения отдаётся вверх отдельным кодом: модератор видит 503 и не может
 * одобрить анкету по «нулю депозитов», которого на самом деле нет.
 */
export class KycDepositTotalUnavailableError extends AppError {
  readonly code = 'KYC_DEPOSIT_TOTAL_UNAVAILABLE'
  readonly httpStatus = 503
  constructor() {
    super('Не удалось получить сумму депозитов игрока для проверки KYC')
  }
}
