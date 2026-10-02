import { AppError } from '@casino/shared-utils'

/** Волна 4 (G17/G18): raw Error / Nest-исключения admin-модуля → AppError.
 *  Тексты сообщений сохранены 1-в-1; статусы выровнены по семантике. */
export class AdminJwtTokenError extends AppError {
  readonly code: string
  readonly httpStatus = 401
  // INVALID_TOKEN — отказы verify, у которых нет своей причины из JWT: битый
  // base64, невалидный JSON payload, отсутствующий JWT_ACCESS_SECRET. Вешать на
  // них BAD_SIGNATURE означало бы искать сломанную подпись там, где её нет.
  constructor(code: 'BAD_SIGNATURE' | 'TOKEN_EXPIRED' | 'INVALID_TOKEN') {
    super(code)
    this.code = code
  }
}
/** 403 вместо прежнего raw Error (500): семантика запрета; текст сохранён. */
export class AdminForbiddenError extends AppError {
  readonly code = 'FORBIDDEN'
  readonly httpStatus = 403
  constructor(m = 'FORBIDDEN') {
    super(m)
  }
}
export class SuperadminOnlyError extends AppError {
  readonly code = 'SUPERADMIN_ONLY'
  readonly httpStatus = 403
  constructor(m = 'superadmin only') {
    super(m)
  }
}
export class InvalidAdminCredentialsError extends AppError {
  readonly code = 'INVALID_ADMIN_CREDENTIALS'
  readonly httpStatus = 401
  constructor(m = 'Неверный email или пароль') {
    super(m)
  }
}
