import { Body, Controller, Post, UsePipes } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'

import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe'

import { type AdminRole, prisma } from '@casino/database'

import { AuditLogService } from '../../application/audit-log.service'
import { InvalidAdminCredentialsError } from '../../domain/errors'
import { AdminAuthService } from '../../infrastructure/admin-jwt.service'
import { AdminLoginSchema } from '../dto/admin-auth.dto'

/**
 * Pre-launch hardening B5 (2026-09-04): брутфорс-защита логина админки.
 * Раньше класс был без Throttle — app-level лимита не было вовсе (nginx
 * api_auth 10r/m смягчает, но это единственный слой; админ-пароль — джекпот).
 * Жёстче, чем /auth/*: 5 попыток/мин на IP (админов единицы, UX не страдает).
 */
@Throttle({
  default: {
    limit: Number(process.env['THROTTLE_ADMIN_LIMIT'] ?? 5),
    ttl: Number(process.env['THROTTLE_TTL_MS'] ?? 60_000),
  },
})
@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private auth: AdminAuthService,
    private audit: AuditLogService,
  ) {}
  @Post('login')
  @UsePipes(new ZodValidationPipe(AdminLoginSchema))
  async login(@Body() body: { email: string; password: string }): Promise<{ accessToken: string; admin: { id: string; email: string; role: AdminRole; }; }> {
    const admin = await this.auth.validate(body.email, body.password)
    if (!admin) {
      // Аудит контрактов 2026-09-26: раньше возвращалось {success:false, error}
      // с HTTP 200 (interceptor пропускал объект с ключом success) — клиент
      // получал data:undefined и «успешный» вход без токена. 401 + стандартный
      // error-конверт из GlobalExceptionFilter — как у всех остальных эндпоинтов.
      throw new InvalidAdminCredentialsError('Неверный email или пароль')
    }
    await prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } })
    await this.audit.log({ actorType: 'admin', actorId: admin.id, action: 'admin.login' })
    const token = this.auth.sign(admin)
    return { accessToken: token, admin: { id: admin.id, email: admin.email, role: admin.role } }
  }
}
