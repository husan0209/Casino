import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { NotificationService } from './application/notification.service'
import { NotificationsController } from './presentation/notifications.controller'

@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationsModule {}
