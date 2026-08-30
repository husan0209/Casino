import { Body, Controller, Post, Req, UseGuards, UsePipes } from '@nestjs/common'

import { prisma } from '@casino/database'

import { CurrentUser } from '../../../../common/decorators/current-user.decorator'
import { ZodValidationPipe } from '../../../../common/pipes/zod-validation.pipe'
import { AuditLogService } from '../../application/audit-log.service'
import { AdminAuthGuard } from '../admin-auth.guard'
import { SendNotificationSchema } from '../dto/admin-notifications.dto'

@UseGuards(AdminAuthGuard)
@Controller('admin/notifications')
export class AdminNotificationsController {
  constructor(private audit: AuditLogService) {}

  @Post('send')
  @UsePipes(new ZodValidationPipe(SendNotificationSchema))
  async sendNotification(
    @Body() body: { userIds: string[]; title: string; message: string; type: string },
    @CurrentUser() admin: any,
    @Req() req: any,
  ) {
    // Send to specific users or all users if userIds is empty
    let targets = body.userIds
    if (!targets || targets.length === 0) {
      const allUsers = await prisma.user.findMany({ select: { id: true } })
      targets = allUsers.map((u: { id: string }) => u.id)
    }

    const notifications = targets.map((userId) => ({
      userId,
      title: body.title,
      message: body.message,
      type: (body.type as any) || 'system',
      channel: 'internal' as const,
      isRead: false,
    }))

    await prisma.notification.createMany({
      data: notifications,
    })

    await this.audit.log({
      actorType: 'admin',
      actorId: admin.id,
      action: 'admin.notifications.sent',
      targetType: 'notification_batch',
      targetId: 'batch',
      payload: { title: body.title, count: targets.length },
      ipAddress: req.ip,
    })

    return { success: true, sentCount: targets.length }
  }
}
