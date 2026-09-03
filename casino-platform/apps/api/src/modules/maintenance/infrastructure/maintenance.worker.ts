import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Worker } from 'bullmq'

import { queueConnection } from '../../../queues/infrastructure/email.queue'
import { QUEUES } from '../../../queues/queue.types'
import { MaintenanceHandlers, MAINTENANCE_HANDLERS } from '../domain/maintenance.ports'

/**
 * Воркер maintenance-очереди (GAP-33): диспетчер по job.name — каждый
 * repeatable-job выстреливает задачу соответствующего application-класса
 * (map хендлеров собирается в MaintenanceModule). Без REDIS_URL (dev) /
 * в test — не создаётся (как EmailWorker).
 */
@Injectable()
export class MaintenanceWorker implements OnModuleDestroy {
  private readonly logger = new Logger(MaintenanceWorker.name)
  private readonly worker?: Worker

  constructor(
    config: ConfigService,
    @Inject(MAINTENANCE_HANDLERS) private readonly handlers: MaintenanceHandlers,
  ) {
    const hasRedis = Boolean(config.get<string>('REDIS_URL'))
    const isTest = config.get<string>('NODE_ENV') === 'test'
    if (!hasRedis || isTest) {
      return
    }
    this.worker = new Worker(
      QUEUES.MAINTENANCE,
      async (job) => {
        const handler = this.handlers[job.name as keyof MaintenanceHandlers] as (() => Promise<unknown>) | undefined
        if (!handler) {
          throw new Error(`Unknown maintenance job: ${job.name}`)
        }
        return handler()
      },
      { connection: queueConnection(config) },
    )
    this.worker.on('failed', (job, err) =>
      this.logger.error(`Maintenance job "${job?.name}" failed: ${err.message}`),
    )
    this.logger.log(`Maintenance worker started on queue "${QUEUES.MAINTENANCE}"`)
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close()
  }
}
