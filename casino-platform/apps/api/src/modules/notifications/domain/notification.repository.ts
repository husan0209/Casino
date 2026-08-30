/**
 * Репозиторий уведомлений. Application-слой не трогает Prisma напрямую
 * (audit §A3/H5). Чтения user/userSettings — cross-module компромисс,
 * TODO(GAP-22): заменить на Facade users-модуля.
 */
import type { Prisma, Notification } from '@prisma/client'

export type NotificationRow = Notification

export interface CreateNotificationInput {
  userId: string
  type: string
  channel: string
  title: string
  message: string
  data: Prisma.InputJsonValue
}

export interface INotificationRepository {
  create(data: CreateNotificationInput): Promise<NotificationRow>
  markSent(id: string, sentAt: Date): Promise<void>
  findMany(
    where: Prisma.NotificationWhereInput,
    skip: number,
    take: number,
  ): Promise<NotificationRow[]>
  count(where: Prisma.NotificationWhereInput): Promise<number>
  markRead(userId: string, id: string): Promise<void>
  markAllRead(userId: string): Promise<void>
  findUserSettings(userId: string): Promise<{ notificationsEmail: boolean | null } | null>
  findUserEmail(userId: string): Promise<string | null>
}

export const NOTIFICATION_REPOSITORY = Symbol('NOTIFICATION_REPOSITORY')
