import { Injectable } from '@nestjs/common'
import { type ConfigService } from '@nestjs/config'
import Redis from 'ioredis'

import { type IHealthProbe, type ProbeName, type ProbeStatus } from '../../domain/health.ports'

const REDIS_CONNECT_TIMEOUT_MS = 1000

/** Проба Redis (GAP-35): PING best-effort — недоступен → 'fail' (degraded, не отказ). */
@Injectable()
export class RedisHealthProbe implements IHealthProbe {
  readonly name: ProbeName = 'redis'

  constructor(private readonly config: ConfigService) {}

  async check(): Promise<ProbeStatus> {
    return (await this.pingRedis()) ? 'ok' : 'fail'
  }

  private async pingRedis(): Promise<boolean> {
    const url = this.config.get<string>('REDIS_URL')
    if (!url) {
      return false
    }
    try {
      const client = new Redis(url, {
        lazyConnect: true,
        connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null,
      })
      await client.connect()
      const pong: unknown = await client.ping()
      await client.quit().catch(() => undefined)
      return String(pong).toUpperCase() === 'PONG'
    } catch {
      return false
    }
  }
}
