import { AppError } from '@casino/shared-utils'

export class EmailAlreadyExistsError extends AppError {
  readonly code = 'EMAIL_ALREADY_EXISTS'
  readonly httpStatus = 409
  constructor(email: string) { super('Пользователь с таким email уже зарегистрирован', { email }) }
}
export class InvalidCredentialsError extends AppError {
  readonly code = 'INVALID_CREDENTIALS'
  readonly httpStatus = 401
  constructor() { super('Неверный email или пароль') }
}
export class EmailNotVerifiedError extends AppError {
  readonly code = 'EMAIL_NOT_VERIFIED'
  readonly httpStatus = 403
  constructor() { super('Подтвердите email') }
}
export class AccountBlockedError extends AppError {
  readonly code = 'ACCOUNT_BLOCKED'
  readonly httpStatus = 403
  constructor() { super('Аккаунт заблокирован') }
}
export class TokenInvalidError extends AppError {
  readonly code = 'TOKEN_INVALID'
  readonly httpStatus = 401
  constructor() { super('Неверный токен') }
}
export class TokenExpiredError extends AppError {
  readonly code = 'TOKEN_EXPIRED'
  readonly httpStatus = 401
  constructor() { super('Токен истёк') }
}
export class TokenAlreadyUsedError extends AppError {
  readonly code = 'TOKEN_ALREADY_USED'
  readonly httpStatus = 409
  constructor() { super('Токен уже использован') }
}
export class SessionInvalidError extends AppError {
  readonly code = 'SESSION_INVALID'
  readonly httpStatus = 401
  constructor() { super('Сессия недействительна') }
}
export class SessionExpiredError extends AppError {
  readonly code = 'SESSION_EXPIRED'
  readonly httpStatus = 401
  constructor() { super('Сессия истекла') }
}
export class WeakPasswordError extends AppError {
  readonly code = 'WEAK_PASSWORD'
  readonly httpStatus = 400
  constructor() { super('Пароль должен содержать минимум 8 символов') }
}
export class ReferralCodeNotFoundError extends AppError {
  readonly code = 'REFERRAL_CODE_NOT_FOUND'
  readonly httpStatus = 404
  constructor(code: string) { super('Реферальный код не найден', { code }) }
}
