import { Worker } from 'bullmq'
import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { prisma } from '@casino/database'
import { type EmailJobData, QUEUES } from '../queue.types'
import { queueConnection } from '../infrastructure/email.queue'
import { MAILER_PORT, MailerPort } from '../infrastructure/mailer.port'

/** Воркер: разбирает очередь `email` и шлёт через MailerPort (SMTP/dev-log). */
@Injectable()
export class EmailWorker implements OnModuleDestroy {
  private readonly logger = new Logger(EmailWorker.name)
  private readonly worker?: Worker<EmailJobData>

  constructor(
    config: ConfigService,
    @Inject(MAILER_PORT) private readonly mailer: MailerPort,
  ) {
    const hasRedis = Boolean(config.get<string>('REDIS_URL'))
    const isTest = config.get<string>('NODE_ENV') === 'test'
    if (!hasRedis || isTest) return
    this.worker = new Worker<EmailJobData>(
      QUEUES.EMAIL,
      async (job) => this.handle(job.data),
      { connection: queueConnection(config) },
    )
    this.worker.on('failed', (job, err) => this.logger.error(`Email job #${job?.id} failed: ${err.message}`))
    this.logger.log(`Email worker started on queue "${QUEUES.EMAIL}"`)
  }

  private async handle(job: EmailJobData) {
    await this.mailer.send({ to: job.to, subject: job.subject, text: job.text, html: job.html })
    if (job.notificationId) {
      await prisma.notification.update({
        where: { id: job.notificationId },
        data: { sentAt: new Date() },
      }).catch(() => this.logger.warn(`sentAt update failed for ${job.notificationId}`))
    }
  }

  async onModuleDestroy() {
    await this.worker?.close()
  }
}
