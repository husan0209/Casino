/**
 * Доменные ошибки партнёрской программы (ТЗ ч.8 §10.4).
 *
 * Все коды — кастомные классы, расширяющие AppError; GlobalExceptionFilter
 * превращает их в errorResponse(code, message, context) (AI_DEVELOPMENT_RULES §5).
 * Коды стабильны: они попадают в контракт API и в audit-лог.
 */
import { AppError } from '@casino/shared-utils'

/** Партнёр не найден (по id или tracking_code). */
export class AffiliateNotFoundError extends AppError {
  readonly code = 'AFFILIATE_NOT_FOUND'
  readonly httpStatus = 404

  constructor(public readonly identifier: string) {
    super(`Affiliate not found: ${identifier}`)
  }
}

/**
 * Партнёр не в статусе active: клик не атрибутируется, регистрация не привязывается.
 * Существующие начисления при этом НЕ отменяются (ТЗ ч.8 §11.3).
 */
export class AffiliateNotActiveError extends AppError {
  readonly code = 'AFFILIATE_NOT_ACTIVE'
  readonly httpStatus = 403

  constructor(public readonly trackingCode: string) {
    super(`Affiliate is not active: ${trackingCode}`)
  }
}

/** Некорректный код в трекинг-ссылке (пустой, слишком длинный, недопустимые символы). */
export class AffiliateCodeInvalidError extends AppError {
  readonly code = 'AFFILIATE_CODE_INVALID'
  readonly httpStatus = 400

  constructor(public readonly code_: string) {
    super(`Invalid affiliate tracking code: ${code_}`)
  }
}

/** Email уже зарегистрирован в партнёрской программе. */
export class AffiliateAlreadyExistsError extends AppError {
  readonly code = 'AFFILIATE_ALREADY_EXISTS'
  readonly httpStatus = 409

  constructor(public readonly email: string) {
    super(`Affiliate already registered: ${email}`)
  }
}

/** Неверный email/пароль партнёра. Сообщение намеренно общее — не раскрывает, существует ли email. */
export class AffiliateCredentialsInvalidError extends AppError {
  readonly code = 'AFFILIATE_CREDENTIALS_INVALID'
  readonly httpStatus = 401

  constructor() {
    super('Invalid affiliate credentials')
  }
}

/**
 * Игрок уже привязан к другому партнёру. Атрибуция неизменяема после создания —
 * «перехват» игрока конкурирующим партнёром запрещён (ТЗ ч.8 §6.3).
 */
export class AffiliateAlreadyAttributedError extends AppError {
  readonly code = 'AFFILIATE_ALREADY_ATTRIBUTED'
  readonly httpStatus = 409

  constructor(
    public readonly playerId: string,
    public readonly currentAffiliateId: string,
  ) {
    super(`Player ${playerId} is already attributed to affiliate ${currentAffiliateId}`)
  }
}

/** Самопривлечение: партнёр привёл самого себя (F1/F2). */
export class AffiliateSelfReferralError extends AppError {
  readonly code = 'AFFILIATE_SELF_REFERRAL'
  readonly httpStatus = 422

  constructor(public readonly reason: 'ip' | 'user_agent') {
    super(`Self-referral detected by ${reason}`)
  }
}

/** Ставка RevShare вне диапазона [0, 1]. */
export class AffiliateRateOutOfRangeError extends AppError {
  readonly code = 'AFFILIATE_RATE_OUT_OF_RANGE'
  readonly httpStatus = 422

  constructor(public readonly rate: string) {
    super(`RevShare rate out of range [0, 1]: ${rate}`)
  }
}

/** Некорректное значение настройки программы. */
export class AffiliateSettingsInvalidError extends AppError {
  readonly code = 'AFFILIATE_SETTINGS_INVALID'
  readonly httpStatus = 422

  constructor(
    public readonly key: string,
    public readonly reason: string,
  ) {
    super(`Invalid affiliate setting ${key}: ${reason}`)
  }
}

/** Фрод-скор выше порога авто-подвеса (F3). */
export class AffiliateFraudSuspectedError extends AppError {
  readonly code = 'AFFILIATE_FRAUD_SUSPECTED'
  readonly httpStatus = 422

  constructor(
    public readonly affiliateId: string,
    public readonly reason: string,
  ) {
    super(`Fraud suspected for affiliate ${affiliateId}: ${reason}`)
  }
}

/**
 * Отмена начисления вне допустимого окна. В MVP начисления не выплачиваются
 * отдельно, поэтому отмена доступна только суперадмину и только в статусе
 * pending/approved (ТЗ ч.8 §11.4).
 */
export class AffiliateClawbackNotAllowedError extends AppError {
  readonly code = 'AFFILIATE_CLAWBACK_NOT_ALLOWED'
  readonly httpStatus = 422

  constructor(
    public readonly commissionId: string,
    public readonly currentStatus: string,
  ) {
    super(`Clawback not allowed for commission ${commissionId} in status ${currentStatus}`)
  }
}
