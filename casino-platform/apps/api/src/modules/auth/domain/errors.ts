import { AppError } from '@casino/shared-utils'

export class InvalidCredentialsError extends AppError {
  readonly code = 'INVALID_CREDENTIALS'
  readonly httpStatus = 401
  constructor() { super('Неверный email или пароль') }
}

export class EmailNotVerifiedError extends AppError {
  readonly code = 'EMAIL_NOT_VERIFIED'
  readonly httpStatus = 403
  constructor() { super('Подтвердите email для входа') }
}

export class AccountBlockedError extends AppError {
  readonly code = 'ACCOUNT_BLOCKED'
  readonly httpStatus = 403
  constructor() { super('Аккаунт заблокирован') }
}

export class EmailAlreadyExistsError extends AppError {
  readonly code = 'EMAIL_ALREADY_EXISTS'
  readonly httpStatus = 409
  constructor() { super('Пользователь с таким email уже существует') }
}

export class WeakPasswordError extends AppError {
  readonly code = 'WEAK_PASSWORD'
  readonly httpStatus = 400
  constructor() { super('Пароль должен содержать минимум 8 символов и минимум 1 цифру') }
}

export class TokenInvalidError extends AppError {
  readonly code = 'TOKEN_INVALID'
  readonly httpStatus = 400
  constructor() { super('Токен недействителен') }
}

export class TokenExpiredError extends AppError {
  readonly code = 'TOKEN_EXPIRED'
  readonly httpStatus = 401
  constructor() { super('Срок действия токена истёк') }
}

export class TokenAlreadyUsedError extends AppError {
  readonly code = 'TOKEN_ALREADY_USED'
  readonly httpStatus = 409
  constructor() { super('Токен уже был использован') }
}

export class SessionInvalidError extends AppError {
  readonly code = 'SESSION_INVALID'
  readonly httpStatus = 401
  constructor() { super('Сессия недействительна') }
}

export class OAuthNotConfiguredError extends AppError {
  readonly code = 'OAUTH_NOT_CONFIGURED'
  readonly httpStatus = 503
  constructor(provider: string) { super(`${provider} OAuth не настроен: отсутствуют ключи в окружении`) }
}

export class OAuthStateError extends AppError {
  readonly code = 'OAUTH_STATE_INVALID'
  readonly httpStatus = 400
  constructor() { super('Некорректный или просроченный state') }
}

export class OAuthExchangeError extends AppError {
  readonly code = 'OAUTH_EXCHANGE_FAILED'
  readonly httpStatus = 401
  constructor(detail?: string) { super(`Обмен кода у провайдера не удался${detail ? ': ' + detail : ''}`) }
}

export class SessionExpiredError extends AppError {
  readonly code = 'SESSION_EXPIRED'
  readonly httpStatus = 401
  constructor() { super('Сессия истекла') }
}

export class SelfExcludedError extends AppError {
  readonly code = 'SELF_EXCLUDED'
  readonly httpStatus = 403
  constructor(public readonly excludedUntil: Date) {
    super(`Аккаунт временно заблокирован по запросу пользователя до ${excludedUntil.toISOString()}`, { excludedUntil })
  }
}
