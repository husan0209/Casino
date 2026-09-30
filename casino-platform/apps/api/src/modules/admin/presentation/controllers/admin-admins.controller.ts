// Inject обязателен в этой сборке: emitDecoratorMetadata не выдаёт
// design:paramtypes, поэтому инъекция «по типу» молча даёт undefined
// (CONVENTIONS §1.4). ForbiddenException убран — в теле файла не используется.
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
  UsePipes,
} from '@nestjs/common'
import { type Request } from 'express'

import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe'
import { type AdminActor } from '@/common/types/req-user'

import { type AdminUserRow } from '@modules/admin/domain/admin.repository'


import { AdminUsersService } from '../../application/admin-users.service'
import { AuditLogService } from '../../application/audit-log.service'
import { SuperadminOnlyError } from '../../domain/errors'
import { AdminAuthGuard } from '../admin-auth.guard'
import { CreateAdminSchema } from '../dto/admin-admins.dto'

function isSuper(req: Request): boolean {
  const user = req.user
  // 'role' in user отсекает AffiliateActor: у партнёрского токена роли нет.
  return user !== undefined && 'role' in user && user.role === 'superadmin'
}
@UseGuards(AdminAuthGuard)
@Controller('admin/admins')
export class AdminAdminsController {
  constructor(
    @Inject(AdminUsersService) private svc: AdminUsersService,
    @Inject(AuditLogService) private audit: AuditLogService,
  ) {}
  @Get() async list(): Promise<AdminUserRow[]> {
    const r = await this.svc.list(1, 100)
    return r.items
  }
  @Post()
  @UsePipes(new ZodValidationPipe(CreateAdminSchema))
  async create(@Body() body: Record<string, unknown>, @Req() req: Request): Promise<AdminUserRow> {
    // Аудит контрактов 2026-09-26: раньше {success:false, error} с HTTP 200 —
    // клиент уходил в onSuccess и рапортовал об успехе. 403 + error-конверт.
    if (!isSuper(req)) {
      throw new SuperadminOnlyError('superadmin only')
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
  async deactivate(@Param('id') id: string, @Req() req: Request): Promise<{ ok: boolean }> {
    if (!isSuper(req)) {
      throw new SuperadminOnlyError('superadmin only')
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
