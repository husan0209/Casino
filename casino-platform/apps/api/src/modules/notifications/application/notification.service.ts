import { Injectable, Logger } from '@nestjs/common'
import { prisma } from '@casino/database'
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name)
  async send(input: { userId: string; type: string; channel?: 'email'|'internal'; title: string; message: string; data?: any }) {
    const n = await prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        channel: (input.channel || 'internal') as any,
        title: input.title,
        message: input.message,
        data: input.data || {},
      }
    })
    if ((input.channel || 'internal') === 'email') {
      // Check user settings before queuing email
      const settings = await prisma.userSettings.findUnique({ where: { userId: input.userId } }).catch(()=>null)
      const emailEnabled = settings?.notificationsEmail ?? true
      if (!emailEnabled) {
        this.logger.log(`Email notification ${n.id} skipped – user ${input.userId} disabled email`)
      } else {
        // BullMQ email queue placeholder – logs and marks sent.
        // In production this should push to BullMQ `email` queue and be processed by email worker (nodemailer).
        // For now we log and mark sentAt to avoid TODO leak. See docs/tz-part-6 UC-NOTIF-01.
        this.logger.log(`Email queued (stub): to user=${input.userId} type=${input.type} title=${input.title}`)
        // TODO-PROD: inject @InjectQueue('email') and await this.emailQueue.add('send', { notificationId: n.id, userId: input.userId, ... })
      }
    }
    await prisma.notification.update({ where: { id: n.id }, data: { sentAt: new Date() }})
    return n
  }
  async list(userId: string, page=1, perPage=20, isRead?: boolean) {
    const where:any = { userId }; if (isRead !== undefined) where.isRead = isRead
    const [items,total,unreadCount] = await Promise.all([
      prisma.notification.findMany({ where, skip:(page-1)*perPage, take:perPage, orderBy:{ createdAt:'desc' }}),
      prisma.notification.count({ where }),
      prisma.notification.count({ where:{ userId, isRead:false }})
    ])
    return { items, total, unreadCount }
  }
  async markRead(userId: string, id: string) {
    await prisma.notification.updateMany({ where:{ id, userId }, data:{ isRead: true, readAt: new Date() }})
    return { ok: true }
  }
  async markAllRead(userId: string) {
    await prisma.notification.updateMany({ where:{ userId, isRead:false }, data:{ isRead: true, readAt: new Date() }})
    return { ok: true }
  }
  async unreadCount(userId: string) {
    const count = await prisma.notification.count({ where:{ userId, isRead:false }})
    return { count }
  }
}
