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
