import { AppError } from '@casino/shared-utils'

export class InvalidCredentialsError extends AppError {
  readonly code = 'INVALID_CREDENTIALS'
  readonly httpStatus = 401
  constructor() {
    super('Неверный email или пароль')
  }
}

export class EmailNotVerifiedError extends AppError {
  readonly code = 'EMAIL_NOT_VERIFIED'
  readonly httpStatus = 403
  constructor() {
    super('Подтвердите email для входа')
  }
}

export class AccountBlockedError extends AppError {
  readonly code = 'ACCOUNT_BLOCKED'
  readonly httpStatus = 403
  constructor() {
    super('Аккаунт заблокирован')
  }
}

export class AccountLockedError extends AppError {
  readonly code = 'ACCOUNT_LOCKED'
  readonly httpStatus = 423
  constructor(public readonly lockedUntil: Date) {
    super(`Слишком много неудачных попыток входа. Повторите после ${lockedUntil.toISOString()}`, {
      lockedUntil,
    })
  }
}

export class EmailAlreadyExistsError extends AppError {
  readonly code = 'EMAIL_ALREADY_EXISTS'
  readonly httpStatus = 409
  constructor() {
    super('Пользователь с таким email уже существует')
  }
}

export class WeakPasswordError extends AppError {
  readonly code = 'WEAK_PASSWORD'
  readonly httpStatus = 400
  constructor() {
    super('Пароль должен содержать минимум 8 символов и минимум 1 цифру')
  }
}

export class CaptchaRequiredError extends AppError {
  readonly code = 'CAPTCHA_REQUIRED'
  readonly httpStatus = 422
  constructor() {
    super('Подтвердите, что вы не робот')
  }
}

export class CaptchaFailedError extends AppError {
  readonly code = 'CAPTCHA_FAILED'
  readonly httpStatus = 422
  constructor(public readonly reason: string) {
    super('Капча не пройдена, попробуйте ещё раз', { reason })
  }
}

export class PasswordNotSetError extends AppError {
  readonly code = 'PASSWORD_NOT_SET'
  readonly httpStatus = 409
  constructor() {
    super('У аккаунта нет пароля — вход через Google/Telegram')
  }
}

export class TokenInvalidError extends AppError {
  readonly code = 'TOKEN_INVALID'
  readonly httpStatus = 400
  constructor() {
    super('Токен недействителен')
  }
}

export class TokenExpiredError extends AppError {
  readonly code = 'TOKEN_EXPIRED'
  readonly httpStatus = 401
  constructor() {
    super('Срок действия токена истёк')
  }
}

export class TokenAlreadyUsedError extends AppError {
  readonly code = 'TOKEN_ALREADY_USED'
  readonly httpStatus = 409
  constructor() {
    super('Токен уже был использован')
  }
}

export class SessionInvalidError extends AppError {
  readonly code = 'SESSION_INVALID'
  readonly httpStatus = 401
  constructor() {
    super('Сессия недействительна')
  }
}

export class OAuthNotConfiguredError extends AppError {
  readonly code = 'OAUTH_NOT_CONFIGURED'
  readonly httpStatus = 503
  constructor(provider: string) {
    super(`${provider} OAuth не настроен: отсутствуют ключи в окружении`)
  }
}

export class OAuthStateError extends AppError {
  readonly code = 'OAUTH_STATE_INVALID'
  readonly httpStatus = 400
  constructor() {
    super('Некорректный или просроченный state')
  }
}

export class OAuthExchangeError extends AppError {
  readonly code = 'OAUTH_EXCHANGE_FAILED'
  readonly httpStatus = 401
  constructor(detail?: string) {
    super(`Обмен кода у провайдера не удался${detail ? ': ' + detail : ''}`)
  }
}

export class SessionExpiredError extends AppError {
  readonly code = 'SESSION_EXPIRED'
  readonly httpStatus = 401
  constructor() {
    super('Сессия истекла')
  }
}

export class SelfExcludedError extends AppError {
  readonly code = 'SELF_EXCLUDED'
  readonly httpStatus = 403
  constructor(public readonly excludedUntil: Date) {
    super(
      `Аккаунт временно заблокирован по запросу пользователя до ${excludedUntil.toISOString()}`,
      { excludedUntil },
    )
  }
}

// ── JWT-верификация (Волна 3в, G17): message = прежний код строки —
// обработчики разбирают текст, поэтому он сохранён 1-в-1.
export type JwtTokenErrorCode =
  'BAD_TOKEN' | 'BAD_ALGORITHM' | 'BAD_SIGNATURE' | 'BAD_ISSUER' | 'BAD_AUDIENCE' | 'TOKEN_EXPIRED'

export class JwtTokenError extends AppError {
  readonly code: string
  readonly httpStatus = 401
  constructor(code: JwtTokenErrorCode) {
    super(code)
    this.code = code
  }
}
export class JwtSecretWeakError extends AppError {
  readonly code = 'JWT_ACCESS_SECRET_MISSING_OR_WEAK'
  readonly httpStatus = 500
  constructor() {
    super('JWT_ACCESS_SECRET_MISSING_OR_WEAK')
  }
}
export class ReferralCodeGenerationError extends AppError {
  readonly code = 'REFERRAL_CODE_GENERATION_FAILED'
  readonly httpStatus = 500
  constructor() {
    super('REFERRAL_CODE_GENERATION_FAILED')
  }
}
export class OAuthUpstreamError extends AppError {
  readonly code = 'OAUTH_UPSTREAM_ERROR'
  readonly httpStatus = 502
  constructor(m: string) {
    super(m)
  }
}
export class OauthUserInvariantError extends AppError {
  readonly code = 'OAUTH_USER_REQUIRES_NULL_PASSWORD'
  readonly httpStatus = 500
  constructor() {
    super('OAUTH_USER_REQUIRES_NULL_PASSWORD')
  }
}
export class CaptchaUpstreamError extends AppError {
  readonly code = 'CAPTCHA_UPSTREAM_ERROR'
  readonly httpStatus = 502
  constructor(m: string) {
    super(m)
  }
}

/**
 * Токен есть, но ролей недостаточно: пользователь не админ, либо роль не входит
 * в требуемый набор @Roles.
 *
 * Отдельный код вместо встроенного исключения NestJS — по правилу 6 ошибки
 * оформляются кастомным классом, а код стабилен и попадает в контракт API.
 * Код и HTTP-статус сохранены один в один, так что клиенты ничего не замечают.
 */
export class InsufficientPermissionsError extends AppError {
  readonly code = 'INSUFFICIENT_PERMISSIONS'
  readonly httpStatus = 403
  constructor() {
    super('INSUFFICIENT_PERMISSIONS')
  }
}
