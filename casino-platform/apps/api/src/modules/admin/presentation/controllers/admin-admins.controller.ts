import { Body, Controller, Get, Param, Post, Req, UseGuards, UsePipes } from '@nestjs/common'
import { AdminUserRow } from '@modules/admin/domain/admin.repository'
import { type Request } from 'express'

import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe'
import { type AdminActor } from '@/common/types/req-user'

import { AdminUsersService } from '../../application/admin-users.service'
import { AuditLogService } from '../../application/audit-log.service'
import { AdminAuthGuard } from '../admin-auth.guard'
import { CreateAdminSchema } from '../dto/admin-admins.dto'

function isSuper(req: Request): boolean {
  return req.user?.role === 'superadmin'
}
@UseGuards(AdminAuthGuard)
@Controller('admin/admins')
export class AdminAdminsController {
  constructor(
    private svc: AdminUsersService,
    private audit: AuditLogService,
  ) {}
  @Get() async list(): Promise<AdminUserRow[]> {
    const r = await this.svc.list(1, 100)
    return r.items
  }
  @Post()
  @UsePipes(new ZodValidationPipe(CreateAdminSchema))
  async create(@Body() body: Record<string, unknown>, @Req() req: Request): Promise<AdminUserRow | { success: boolean; error: { code: string; message: string; }; }> {
    if (!isSuper(req)) {
      return { success: false, error: { code: 'FORBIDDEN', message: 'superadmin only' } }
    }
    const admin = await this.svc.create(
      body as unknown as Parameters<typeof this.svc.create>[0],
      (req.user as AdminActor).id,
    )
    await this.audit.log({
      actorType: 'admin',
      actorId: (req.user as AdminActor).id,
      action: 'admin.admin_created',
      targetType: 'admin_user',
      targetId: admin.id,
    })
    return admin
  }
  @Post(':id/deactivate')
  async deactivate(@Param('id') id: string, @Req() req: Request): Promise<{ success: boolean; error: { code: string; message: string; }; ok?: never; } | { ok: boolean; success?: never; error?: never; }> {
    if (!isSuper(req)) {
      return { success: false, error: { code: 'FORBIDDEN', message: 'superadmin only' } }
    }
    await this.svc.block(id)
    await this.audit.log({
      actorType: 'admin',
      actorId: (req.user as AdminActor).id,
      action: 'admin.admin_deactivated',
      targetId: id,
    })
    return { ok: true }
  }
}
