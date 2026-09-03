import { Body, Controller, Post, UsePipes } from '@nestjs/common'
import { AdminRole } from '@casino/database'

import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe'

import { prisma } from '@casino/database'

import { AuditLogService } from '../../application/audit-log.service'
import { AdminAuthService } from '../../infrastructure/admin-jwt.service'
import { AdminLoginSchema } from '../dto/admin-auth.dto'

@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private auth: AdminAuthService,
    private audit: AuditLogService,
  ) {}
  @Post('login')
  @UsePipes(new ZodValidationPipe(AdminLoginSchema))
  async login(@Body() body: { email: string; password: string }): Promise<{ success: boolean; error: { code: string; message: string; }; accessToken?: never; admin?: never; } | { accessToken: string; admin: { id: string; email: string; role: AdminRole; }; success?: never; error?: never; }> {
    const admin = await this.auth.validate(body.email, body.password)
    if (!admin) {
      return {
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Неверный email или пароль' },
      }
    }
    await prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } })
    await this.audit.log({ actorType: 'admin', actorId: admin.id, action: 'admin.login' })
    const token = this.auth.sign(admin)
    return { accessToken: token, admin: { id: admin.id, email: admin.email, role: admin.role } }
  }
}
