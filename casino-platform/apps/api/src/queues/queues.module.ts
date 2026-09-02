import { Module } from '@nestjs/common'
import type Redis from 'ioredis'
import { ConfigService } from '@nestjs/config'

import { EmailWorker } from './application/email.worker'
import { BullMqEmailQueue, DevLogEmailQueue } from './infrastructure/email.queue'
import { mailerFactory } from './infrastructure/smtp.mailer'
import { EMAIL_QUEUE_PORT, MAILER_PORT } from './queue.types'

/**
 * BullMQ-очереди (TZ part 6 §11, IMPLEMENTATION_GAPS GAP-02):
 * - очередь `email`: продюсеры (auth, notifications) через EMAIL_QUEUE_PORT;
 * - EmailWorker — консьюмер в том же процессе (MVP; вынос в отдельный процесс — после MVP);
 * - MAILER_PORT — фактическая отправка: SMTP_HOST → SmtpMailer, иначе DevLogMailer (dev only).
 * Без REDIS_URL (dev) продюсер = DevLogEmailQueue; в production Redis и SMTP обязательны.
 */
@Module({
  providers: [
    {
      provide: MAILER_PORT,
      useFactory: mailerFactory,
      inject: [ConfigService],
    },
    {
      provide: EMAIL_QUEUE_PORT,
      useFactory: (config: ConfigService): Redis => {
        if (config.get<string>('REDIS_URL')) {
          return new BullMqEmailQueue(config)
        }
        if (config.get<string>('NODE_ENV') === 'production') {
          throw new Error('REDIS_URL_REQUIRED_IN_PRODUCTION')
        }
        return new DevLogEmailQueue()
      },
      inject: [ConfigService],
    },
    EmailWorker,
  ],
  exports: [EMAIL_QUEUE_PORT],
})
export class QueuesModule {}
