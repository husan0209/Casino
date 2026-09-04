/**
 * Репозиторий уведомлений. Application-слой не трогает Prisma напрямую
 * (audit §A3/H5). Чтения user/userSettings — cross-module компромисс:
 * таблицы принадлежат users-модулю, а читаются напрямую (`user`, `user_settings`)
 * вместо `UsersFacade`. Заменить на порт users-модуля — см. **GAP-51**.
 *
 * (Раньше здесь стоял TODO со ссылкой на GAP-22, но тот гэп закрыт 2026-08-31 и
 * про другое: 4-слойка wallet, `toMoney`, `runCreditDebit` — эта работа в его
 * критериях не значилась, то есть метка указывала на закрытый гэп и долг не трекся.)
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
