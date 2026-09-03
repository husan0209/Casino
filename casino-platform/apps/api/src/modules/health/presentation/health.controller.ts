import { Controller, Get, Res } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Response } from 'express'

import { prisma } from '@casino/database'



/** GAP-35: честный readiness — SELECT 1 к БД (fail-closed) + PING Redis (best-effort) */
const REDIS_CONNECT_TIMEOUT_MS = 1000

@Controller('health')
export class HealthController {
  constructor(private config: ConfigService) {}

  @Get()
  getHealth(): { status: string; timestamp: string; } {
    return { status: 'ok', timestamp: new Date().toISOString() }
  }

  @Get('live') liveness(): { live: boolean; } {
    return { live: true }
  }

  @Get('ready')
  async readiness(@Res() res: Response): Promise<void> {
    const checks: Record<string, 'ok' | 'fail' | 'degraded'> = {
      db: 'fail',
      redis: 'fail',
    }

    await Promise.all([
      prisma
        .$queryRaw`SELECT 1`
        .then(() => {
          checks.db = 'ok'
        })
        .catch(() => undefined),
      this.pingRedis().then((ok) => {
        checks.redis = ok ? 'ok' : 'fail'
      }),
    ])

    // Redis недоступен → 200 degraded (queue-only деградация); БД недоступна → 503
    const degraded = checks.redis !== 'ok'
    if (checks.db !== 'ok') {
      res.status(503).send({ ready: false, ...checks })
      return
    }
    res.status(200).send({ ready: true, degraded, ...checks })
  }

  private async pingRedis(): Promise<boolean> {
    const url = this.config.get<string>('REDIS_URL')
    if (!url) {
      return false
    }
    try {
      const Redis = (await import('ioredis')).default
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
