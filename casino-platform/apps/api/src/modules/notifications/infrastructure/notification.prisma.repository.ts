import { Injectable } from '@nestjs/common'

import { prisma } from '@casino/database'
import type { Prisma } from '@prisma/client'

import {
  type CreateNotificationInput,
  type INotificationRepository,
  type NotificationRow,
} from '../../domain/notification.repository'

@Injectable()
export class PrismaNotificationRepository implements INotificationRepository {
  create(data: CreateNotificationInput): Promise<NotificationRow> {
    return prisma.notification.create({ data })
  }

  async markSent(id: string, sentAt: Date): Promise<void> {
    await prisma.notification.update({ where: { id }, data: { sentAt } })
  }

  findMany(
    where: Prisma.NotificationWhereInput,
    skip: number,
    take: number,
  ): Promise<NotificationRow[]> {
    return prisma.notification.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } })
  }

  count(where: Prisma.NotificationWhereInput): Promise<number> {
    return prisma.notification.count({ where })
  }

  async markRead(userId: string, id: string): Promise<void> {
    await prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true, readAt: new Date() },
    })
  }

  async markAllRead(userId: string): Promise<void> {
    await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    })
  }

  findUserSettings(userId: string): Promise<{ notificationsEmail: boolean | null } | null> {
    return prisma.userSettings.findUnique({
      where: { userId },
      select: { notificationsEmail: true },
    })
  }

  findUserEmail(userId: string): Promise<string | null> {
    return prisma.user
      .findUnique({ where: { id: userId }, select: { email: true } })
      .then((u) => u?.email ?? null)
  }
}
