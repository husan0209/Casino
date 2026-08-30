import { Module } from '@nestjs/common'

import { NotificationService } from './application/notification.service'
import { NOTIFICATION_REPOSITORY } from './domain/notification.repository'
import { PrismaNotificationRepository } from './infrastructure/notification.prisma.repository'
import { NotificationsController } from './presentation/notifications.controller'
import { QueuesModule } from '../../queues/queues.module'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [AuthModule, QueuesModule],
  controllers: [NotificationsController],
  providers: [
    NotificationService,
    { provide: NOTIFICATION_REPOSITORY, useClass: PrismaNotificationRepository },
  ],
  exports: [NotificationService],
})
export class NotificationsModule {}
