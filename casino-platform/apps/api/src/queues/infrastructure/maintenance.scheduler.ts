import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Queue } from 'bullmq'


import { MAINTENANCE_JOBS, QUEUES, type MaintenanceJobName } from '../queue.types'
import { queueConnection } from './email.queue'

import type Redis from 'ioredis'

/** Интервалы повторения по умолчанию — переопределяются env (GAP-33 criterion 1). */
const DEFAULTS: Record<MaintenanceJobName, number> = {
  'expire-deposits': 300_000,
  'update-rates': 300_000,
  'withdrawal-reminder': 3_600_000,
  'referral-daily': 86_400_000,
}

const ENV_KEYS: Record<MaintenanceJobName, string> = {
  'expire-deposits': 'JOB_EXPIRE_DEPOSITS_EVERY_MS',
  'update-rates': 'JOB_UPDATE_RATES_EVERY_MS',
  'withdrawal-reminder': 'JOB_WITHDRAWAL_REMINDER_EVERY_MS',
  'referral-daily': 'JOB_REFERRAL_DAILY_EVERY_MS',
}

/**
 * Регистрирует repeatable-job'ы maintenance-очереди (GAP-33).
 * BullMQ Job Schedulers (upsertJobScheduler, every): повторная регистрация
 * с тем же id — апдейт интервала, дубликаты не создаются. Интервалы — из env.
 * Без REDIS_URL (dev) / в test — no-op (как EmailWorker).
 */
@Injectable()
export class MaintenanceScheduler implements OnModuleDestroy {
  private readonly logger = new Logger(MaintenanceScheduler.name)
  private readonly queue?: Queue
  private readonly connection?: Redis

  constructor(config: ConfigService) {
    const hasRedis = Boolean(config.get<string>('REDIS_URL'))
    const isTest = config.get<string>('NODE_ENV') === 'test'
    if (!hasRedis || isTest) {
      this.logger.log('Maintenance scheduler disabled (no REDIS_URL or test env)')
      return
    }
    this.connection = queueConnection(config)
    this.queue = new Queue(QUEUES.MAINTENANCE, { connection: this.connection })
  }

  /** Вызывается на старте приложения (MaintenanceModule.onApplicationBootstrap). */
  async registerRepeatableJobs(): Promise<void> {
    if (!this.queue) {
      return
    }
    for (const name of MAINTENANCE_JOBS) {
      const every = Number(process.env[ENV_KEYS[name]]) || DEFAULTS[name]
      await this.queue.upsertJobScheduler(`maintenance:${name}`, { every }, { name })
      this.logger.log(`Maintenance job "${name}" scheduled every ${every}ms`)
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close()
    this.connection?.disconnect()
  }
}
