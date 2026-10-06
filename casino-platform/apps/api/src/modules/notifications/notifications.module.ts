import { Module } from '@nestjs/common'

import { NotificationService } from './application/notification.service'
import { NOTIFICATION_REPOSITORY } from './domain/notification.repository'
import { NotificationsFacade } from './facade/notifications.facade'
import { PrismaNotificationRepository } from './infrastructure/notification.prisma.repository'
import { NotificationsController } from './presentation/notifications.controller'
import { QueuesModule } from '../../queues/queues.module'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [AuthModule, QueuesModule],
  controllers: [NotificationsController],
  providers: [
    NotificationService,
    NotificationsFacade,
    { provide: NOTIFICATION_REPOSITORY, useClass: PrismaNotificationRepository },
  ],
  // Фасад — точка входа для других модулей (правило 4, гард G16/G24).
  // NotificationService оставляем в exports как было: внешних потребителей у него
  // сейчас нет, но removal — это отдельная проверка контракта, не эта задача.
  exports: [NotificationService, NotificationsFacade],
})
export class NotificationsModule {}
