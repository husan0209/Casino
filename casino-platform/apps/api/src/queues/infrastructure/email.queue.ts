import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Queue } from 'bullmq'
import Redis from 'ioredis'

import { errorMessage } from '@/common/utils/error-message'

import { type EmailJobData, type EmailQueuePort, type EnqueueResult, QUEUES } from '../queue.types'

export function queueConnection(config: ConfigService): Redis {
  return new Redis(config.get<string>('REDIS_URL')!, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  })
}

/** Продюсер: пишет письма в BullMQ-очередь `email`. Сбой постановки не роняет HTTP-запрос. */
@Injectable()
export class BullMqEmailQueue implements EmailQueuePort {
  private readonly logger = new Logger(BullMqEmailQueue.name)
  private readonly queue: Queue<EmailJobData>

  constructor(config: ConfigService) {
    this.queue = new Queue<EmailJobData>(QUEUES.EMAIL, {
      connection: queueConnection(config),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    })
  }

  async enqueue(job: EmailJobData): Promise<EnqueueResult> {
    try {
      await this.queue.add('send', job)
      this.logger.log(`Email enqueued: to=${job.to} subject="${job.subject}"`)
      return 'queued'
    } catch (e) {
      // Письмо — side-effect: не блокируем бизнес-операцию, но фиксируем потерю
      this.logger.error(`Email enqueue FAILED (письмо утеряно): ${errorMessage(e)}`)
      return 'logged'
    }
  }
}

/** Fallback без Redis: лог вместо отправки (dev/test). */
@Injectable()
export class DevLogEmailQueue implements EmailQueuePort {
  private readonly logger = new Logger(DevLogEmailQueue.name)
  async enqueue(job: EmailJobData): Promise<EnqueueResult> {
    this.logger.log(`EMAIL[dev-queue] to=${job.to} subject="${job.subject}"\n${job.text}`)
    return 'logged'
  }
}
