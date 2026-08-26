import { Module } from '@nestjs/common'

import { NotificationService } from './application/notification.service'
import { NotificationsController } from './presentation/notifications.controller'
import { QueuesModule } from '../../queues/queues.module'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [AuthModule, QueuesModule],
  controllers: [NotificationsController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationsModule {}
