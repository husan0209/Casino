import { AppError } from '@casino/shared-utils'

/** Волна 3в (G17/G18): raw Error / Nest-исключения users-модуля → AppError. */
export class MeNotFoundError extends AppError {
  readonly code = 'NOT_FOUND'
  readonly httpStatus = 404
  constructor(m = 'NOT_FOUND') {
    super(m)
  }
}
export class InvalidSelfExclusionPeriodError extends AppError {
  readonly code = 'INVALID_PERIOD'
  readonly httpStatus = 400
  constructor() {
    super('INVALID_PERIOD')
  }
}
/** 403 сохранён от прежнего ForbiddenException; тексты 1-в-1 (Волна 4, G18). */
export class SessionRevokeForbiddenError extends AppError {
  readonly code = 'SESSION_REVOKE_FORBIDDEN'
  readonly httpStatus = 403
  constructor(m: string) {
    super(m)
  }
}
