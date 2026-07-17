import { Body, Controller, Post } from '@nestjs/common'
import { AdminAuthService } from '../../infrastructure/admin-jwt.service'
import { prisma } from '@casino/database'
import { AuditLogService } from '../../application/audit-log.service'
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private auth: AdminAuthService, private audit: AuditLogService) {}
  @Post('login')
  async login(@Body() body: { email: string; password: string }) {
    const admin = await this.auth.validate(body.email, body.password)
    if (!admin) return { success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Неверный email или пароль' }}
    await prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() }})
    await this.audit.log({ actorType: 'admin', actorId: admin.id, action: 'admin.login' })
    const token = this.auth.sign(admin)
    return { accessToken: token, admin: { id: admin.id, email: admin.email, role: admin.role } }
  }
}
