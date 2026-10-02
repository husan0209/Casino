import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common'

import { getHttpRequest } from '@/common/types/express-context'
import { type AdminActor } from '@/common/types/req-user'

import { AppError } from '@casino/shared-utils'

import { AdminJwtTokenError, InvalidAdminCredentialsError } from '../domain/errors'
import { AdminAuthService } from '../infrastructure/admin-jwt.service'

/**
 * Guard админ-контура: пропускает только токен с aud='admin'.
 *
 * Отказы — доменные AppError (G17/G18), а не Nest UnauthorizedException:
 * GlobalExceptionFilter отдаёт их как {success:false,error:{code,message}} со
 * статусом 401, и оператор видит *причину* отказа (токена нет / чужой
 * audience / битая подпись / истёк срок), а не один безликий «Unauthorized».
 * Статусы сохранены: все ветки отказа были и остаются 401.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(@Inject(AdminAuthService) private readonly adminAuth: AdminAuthService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const request = getHttpRequest(ctx)
    const authHeader = request.headers.authorization ?? ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) {
      throw new InvalidAdminCredentialsError(
        'Требуется токен администратора (Authorization: Bearer …)',
      )
    }

    const payload = this.verifyAdminToken(token)
    const audience = typeof payload['aud'] === 'string' ? payload['aud'] : ''
    if (audience !== 'admin') {
      throw new InvalidAdminCredentialsError('Токен выдан не для админ-контура')
    }

    const subject = typeof payload['sub'] === 'string' ? payload['sub'] : ''
    const role = typeof payload['role'] === 'string' ? payload['role'] : ''
    request.user = { id: subject, role, isAdmin: true } satisfies AdminActor
    return true
  }

  /**
   * Доменные отказы verify (BAD_SIGNATURE / TOKEN_EXPIRED) — уже AppError с
   * 401, отдаём их как есть: раньше их проглатывал catch-all и клиент видел
   * «Unauthorized» вместо причины. Всё остальное (битый base64, невалидный
   * JSON payload, отсутствующий JWT_ACCESS_SECRET) наружу не раскрываем, но
   * и не превращаем в 500: это по-прежнему отказ аутентификации.
   */
  private verifyAdminToken(token: string): Record<string, unknown> {
    try {
      return this.adminAuth.verify(token) as Record<string, unknown>
    } catch (error) {
      if (error instanceof AppError) {
        throw error
      }
      throw new AdminJwtTokenError('INVALID_TOKEN')
    }
  }
}
