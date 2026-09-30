import { AppError } from '@casino/shared-utils'

export class GameNotFoundError extends AppError {
  readonly code = 'GAME_NOT_FOUND'
  readonly httpStatus = 404
  constructor(slug: string) {
    super(`Game ${slug} not found`)
  }
}
export class GameDisabledError extends AppError {
  readonly code = 'GAME_DISABLED'
  readonly httpStatus = 422
  constructor() {
    super('Game is disabled')
  }
}
export class ProviderDisabledError extends AppError {
  readonly code = 'PROVIDER_MAINTENANCE'
  readonly httpStatus = 422
  constructor() {
    super('Provider is offline')
  }
}
export class GameSessionInvalidError extends AppError {
  readonly code = 'GAME_SESSION_INVALID'
  readonly httpStatus = 422
  constructor() {
    super('Invalid or expired game session')
  }
}
export class ProviderNotSupportedError extends AppError {
  readonly code = 'PROVIDER_NOT_SUPPORTED'
  readonly httpStatus = 501
  constructor(slug: string) {
    super(`Provider ${slug} not supported`)
  }
}
export class CurrencyNotSupportedError extends AppError {
  readonly code = 'CURRENCY_NOT_SUPPORTED'
  readonly httpStatus = 422
  constructor(currency: string) {
    super(`Currency ${currency} is not supported for this game`, { currency })
  }
}
// ── Provider-callback контракт (Волна 3б): message = прежний код — маппинг
// CALLBACK_ERROR_CODES в контроллере ищет по сообщению, тексты 1-в-1 (G17/G18).
export class SessionInvalidError extends AppError {
  readonly code = 'SESSION_INVALID'
  readonly httpStatus = 401
  constructor() {
    super('SESSION_INVALID')
  }
}
export class PlayerBlockedError extends AppError {
  readonly code = 'PLAYER_BLOCKED'
  readonly httpStatus = 403
  constructor() {
    super('PLAYER_BLOCKED')
  }
}
export class InvalidBetRequestError extends AppError {
  readonly code = 'INVALID_BET_REQUEST'
  readonly httpStatus = 400
  constructor() {
    super('INVALID_BET_REQUEST')
  }
}
export class InvalidWinRequestError extends AppError {
  readonly code = 'INVALID_WIN_REQUEST'
  readonly httpStatus = 400
  constructor() {
    super('INVALID_WIN_REQUEST')
  }
}
export class InvalidRollbackRequestError extends AppError {
  readonly code = 'INVALID_ROLLBACK_REQUEST'
  readonly httpStatus = 400
  constructor() {
    super('INVALID_ROLLBACK_REQUEST')
  }
}
export class RollbackOfRollbackError extends AppError {
  readonly code = 'CANNOT_ROLLBACK_A_ROLLBACK'
  readonly httpStatus = 409
  constructor() {
    super('CANNOT_ROLLBACK_A_ROLLBACK')
  }
}
export class DemoProviderDisabledError extends AppError {
  readonly code = 'DEMO_PROVIDER_DISABLED'
  readonly httpStatus = 500
  constructor(msg: string) {
    super(msg)
  }
}
export class CasinoProviderError extends AppError {
  readonly code = 'CASINO_PROVIDER_ERROR'
  readonly httpStatus = 502
  constructor(msg: string) {
    super(msg)
  }
}
export class CasinoEntityNotFoundError extends AppError {
  readonly code = 'NOT_FOUND'
  readonly httpStatus = 404
  constructor(m = 'NOT_FOUND') {
    super(m)
  }
}
export class CasinoProviderNotConfiguredError extends AppError {
  readonly code = 'CASINO_PROVIDER_NOT_CONFIGURED'
  readonly httpStatus = 503
  constructor(provider: string, keys: string) {
    super(`${provider}: отсутствуют обязательные ключи (${keys})`, { provider })
  }
}
