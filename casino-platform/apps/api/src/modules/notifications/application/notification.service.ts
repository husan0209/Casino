import { Inject, Injectable, Logger } from '@nestjs/common'

import { EMAIL_QUEUE_PORT, EmailQueuePort } from '@/queues/queue.types'

import {
  NOTIFICATION_REPOSITORY,
  type CreateNotificationInput,
  INotificationRepository,
  type NotificationRow,
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
    const n = await this.repo.create(createData)
    if ((input.channel ?? 'internal') === 'email') {
      // Check user settings before queuing email
      const settings = await this.repo.findUserSettings(input.userId).catch(() => null)
      const emailEnabled = settings?.notificationsEmail ?? true
      if (!emailEnabled) {
        this.logger.log(`Email notification ${n.id} skipped – user ${input.userId} disabled email`)
      } else {
        const email = await this.repo.findUserEmail(input.userId)
        if (!email) {
          this.logger.warn(
            `Email notification ${n.id}: у пользователя ${input.userId} нет email – пропущено`,
          )
        } else {
          // UC-NOTIF-01: постановка в очередь; sentAt проставит EmailWorker после фактической отправки
          await this.emailQueue.enqueue({
            to: email,
            subject: input.title,
            text: input.message,
            html: input.message,
            notificationId: n.id,
          })
        }
      }
    } else {
      await this.repo.markSent(n.id, new Date())
    }
    return n
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
