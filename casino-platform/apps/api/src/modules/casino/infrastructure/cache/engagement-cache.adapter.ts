/**
 * ТЗ ч.9 §6.4 — Redis-кэш Engagement Score.
 *
 * Кэш не источник истины: при промахе Score считается из состояния в БД и
 * кладётся с TTL. Любая ошибка Redis проглатывается — движок вовлечения
 * не должен ронять спин из-за кэша (§17: спин важнее оптимизации).
 */
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'

import { DEFAULT_ENGAGEMENT_CONFIG } from '../../domain/engagement'
import {
  ENGAGEMENT_CACHE,
  engagementScoreKey,
  type IEngagementCache,
} from '../../domain/repositories/engagement-cache.port'

@Injectable()
export class RedisEngagementCache implements IEngagementCache, OnModuleDestroy {
  private redis: Redis | null = null

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  async getScore(userId: string, gameId: string): Promise<number | null> {
    try {
      const raw = await this.client().get(engagementScoreKey(userId, gameId))
      if (raw === null) {
        return null
      }
      const parsed = Number(raw)
      return Number.isFinite(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  async setScore(userId: string, gameId: string, score: number): Promise<void> {
    try {
      const ttl =
        this.config.get<number>('ENGAGEMENT_SCORE_TTL_SECONDS') ??
        DEFAULT_ENGAGEMENT_CONFIG.scoreCacheTtlSeconds
      await this.client().set(engagementScoreKey(userId, gameId), String(score), 'EX', ttl)
    } catch {
      // Кэш — ускоритель; его отказ не должен ломать спин.
    }
  }

  async invalidate(userId: string, gameId: string): Promise<void> {
    try {
      await this.client().del(engagementScoreKey(userId, gameId))
    } catch {
      // см. выше
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis?.quit().catch(() => {})
  }

  private client(): Redis {
    const url = this.config.getOrThrow<string>('REDIS_URL')
    this.redis ??= new Redis(url, { maxRetriesPerRequest: null, lazyConnect: true })
    return this.redis
  }
}

export const ENGAGEMENT_CACHE_PROVIDER = {
  provide: ENGAGEMENT_CACHE,
  useClass: RedisEngagementCache,
}
