import { Inject, Injectable, Logger } from '@nestjs/common'

import { errorMessage } from '@/common/utils/error-message'
import { EMAIL_QUEUE_PORT, type EmailQueuePort } from '@/queues/queue.types'
import { renderNotificationEmail } from '@/queues/templates'

import {
  type BroadcastNotificationInput,
  NOTIFICATION_REPOSITORY,
  type CreateNotificationInput,
  type INotificationRepository,
  type NotificationRow,
  type UserEmailSettingsRow,
} from '../domain/notification.repository'

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name)
  constructor(
    @Inject(EMAIL_QUEUE_PORT) private readonly emailQueue: EmailQueuePort,
    @Inject(NOTIFICATION_REPOSITORY) private readonly repo: INotificationRepository,
  ) {}

  async send(input: {
    userId: string
    type: string
    channel?: 'email' | 'internal'
    title: string
    message: string
    data?: Record<string, unknown>
  }): Promise<NotificationRow> {
    const createData: CreateNotificationInput = {
      userId: input.userId,
      type: input.type,
      channel: input.channel ?? 'internal',
      title: input.title,
      message: input.message,
      data: (input.data ?? {}) as CreateNotificationInput['data'],
    }
    const notification = await this.repo.create(createData)
    if ((input.channel ?? 'internal') === 'email') {
      await this.dispatchEmail(notification, input)
    } else {
      await this.repo.markSent(notification.id, new Date())
    }
    return notification
  }

  /**
   * Email-канал уведомления: проверка отказа от рассылок (fail-closed) и
   * постановка в очередь. UC-NOTIF-01: sentAt проставит EmailWorker после
   * фактической отправки, поэтому здесь он не выставляется.
   */
  private async dispatchEmail(
    notification: NotificationRow,
    input: { userId: string; title: string; message: string },
  ): Promise<void> {
    if (!(await this.isEmailDeliveryAllowed(notification.id, input.userId))) {
      return
    }
    const email = await this.repo.findUserEmail(input.userId)
    if (!email) {
      this.logger.warn(
        `Email notification ${notification.id}: у пользователя ${input.userId} нет email – пропущено`,
      )
      return
    }
    // GAP-02 post-MVP: html — брендированный шаблон (раньше в html уходил сырой text)
    const mail = renderNotificationEmail({ title: input.title, message: input.message })
    await this.emailQueue.enqueue({
      to: email,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      notificationId: notification.id,
    })
  }

  /**
   * Fail-closed проверка opt-out (compliance): отправка необратима, поэтому
   * сбой чтения настроек НЕ должен превращаться в «разрешено» — письмо
   * не уходит, факт пишется в лог (Pino через Logger).
   *
   * Отсутствие строки настроек — не сбой, а «явного отказа нет»: отписаться
   * можно только записав строку (users/userSettings upsert), значит действует
   * schema-default `notifications_email = true`.
   */
  private async isEmailDeliveryAllowed(notificationId: string, userId: string): Promise<boolean> {
    let settings: UserEmailSettingsRow | null
    try {
      settings = await this.repo.findUserSettings(userId)
    } catch (error) {
      this.logger.error(
        `Email notification ${notificationId}: настройки уведомлений пользователя ${userId} не прочитаны (${errorMessage(
          error,
        )}) — письмо НЕ отправлено (fail-closed)`,
      )
      return false
    }
    if (!settings) {
      return true
    }
    if (settings.notificationsEmail === false) {
      this.logger.log(
        `Email notification ${notificationId} skipped – user ${userId} disabled email`,
      )
      return false
    }
    return true
  }

  /**
   * Массовая внутренняя рассылка (админ-бродкаст).
   *
   * Отдельный метод, а не цикл по `send()`: у рассылки нет email-канала и нет
   * очереди — N строк одним `createMany`. Возвращает число вставленных строк:
   * именно его админ показывает как `sentCount`.
   */
  broadcast(rows: BroadcastNotificationInput[]): Promise<number> {
    return this.repo.createMany(rows)
  }

  async list(args: {
    userId: string
    page: number
    perPage: number
    isRead?: boolean
  }): Promise<{ items: NotificationRow[]; total: number; unreadCount: number }> {
    const { userId, page, perPage, isRead } = args
    const where: { userId: string; isRead?: boolean } = { userId }
    if (isRead !== undefined) {
      where.isRead = isRead
    }
    const [items, total, unreadCount] = await Promise.all([
      this.repo.findMany(where, (page - 1) * perPage, perPage),
      this.repo.count(where),
      this.repo.count({ userId, isRead: false }),
    ])
    return { items, total, unreadCount }
  }

  async markRead(userId: string, id: string): Promise<{ ok: boolean }> {
    await this.repo.markRead(userId, id)
    return { ok: true }
  }

  async markAllRead(userId: string): Promise<{ ok: boolean }> {
    await this.repo.markAllRead(userId)
    return { ok: true }
  }

  async unreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.repo.count({ userId, isRead: false })
    return { count }
  }
}
