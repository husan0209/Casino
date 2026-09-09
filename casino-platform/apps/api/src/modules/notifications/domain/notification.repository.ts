/**
 * Репозиторий уведомлений. Application-слой не трогает Prisma напрямую
 * (audit §A3/H5).
 *
 * ADR GAP-51 (закрыт 2026-09-04 как ПРИНЯТОЕ РЕШЕНИЕ): чтения user/userSettings
 * (read-only findUnique по двум полям) напрямую через общий Prisma-клиент —
 * осознанный компромисс, НЕ долг. Рационале: (а) Prisma-клиент один на
 * приложение, «UsersFacade» был бы тем же SQL с лишним слоем; (б) зависимость
 * `notifications → users` в MODULE_BOUNDARIES §15/§9 разрешена; (в) только
 * чтение email/флага рассылки — money-контур не трогается. Порт вводится при
 * выносе users в отдельный сервис — отдельное решение владельца.
 *
 * (Исторически здесь стоял TODO со ссылкой на GAP-22 — закрытый 2026-08-31 и
 * про другое: 4-слойка wallet, `toMoney`, `runCreditDebit`. Метка указывала на
 * закрытый гэп, и долг не трекся — разобрано при закрытии GAP-48.)
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
