import { Body, Controller, Inject, Post, Req, UseGuards, UsePipes } from '@nestjs/common'
import { type Request } from 'express'

import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe'
import { type AdminActor } from '@/common/types/req-user'

import { AdminBroadcastService } from '../../application/admin-broadcast.service'
import { AuditLogService } from '../../application/audit-log.service'
import { AdminAuthGuard } from '../admin-auth.guard'
import { SendNotificationSchema } from '../dto/admin-notifications.dto'

@UseGuards(AdminAuthGuard)
@Controller('admin/notifications')
export class AdminNotificationsController {
  constructor(
    @Inject(AdminBroadcastService) private broadcast: AdminBroadcastService,
    @Inject(AuditLogService) private audit: AuditLogService,
  ) {}

  @Post('send')
  @UsePipes(new ZodValidationPipe(SendNotificationSchema))
  async sendNotification(
    @Body() body: { userIds: string[]; title: string; message: string; type: string },
    @CurrentUser() admin: AdminActor,
    @Req() req: Request,
  ): Promise<{ success: boolean; sentCount: number }> {
    const res = await this.broadcast.send(body.userIds, {
      title: body.title,
      message: body.message,
      type: body.type,
    })
    await this.audit.log({
      actorType: 'admin',
      actorId: admin.id,
      action: 'admin.notifications.sent',
      targetType: 'notification_batch',
      targetId: 'batch',
      payload: { title: body.title, count: res.sentCount },
      ipAddress: req.ip,
    })
    return res
  }
}
