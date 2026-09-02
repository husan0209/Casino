import { Injectable, type OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'

import { prisma } from '@casino/database'

import type { IExchangeRatesReader } from '../application/exchange-rates.service'

/** Ключ Redis-кеша курсов (пишет UpdateRatesJob из maintenance, TTL 300 с) */
const RATES_CACHE_KEY = 'exchange_rates:rub'

@Injectable()
export class PrismaExchangeRatesReader implements IExchangeRatesReader, OnModuleDestroy {
  private redis: Redis | null = null

  constructor(private readonly config: ConfigService) {}

  async getCachedRates(): Promise<Record<string, string> | null> {
    const redis = this.getRedis()
    if (!redis) {
      return null
    }
    const raw = await redis.get(RATES_CACHE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, string>) : null
  }

  async getLatestRate(
    currencyFrom: string,
  ): Promise<{ rate: string; fetchedAt: Date; source: string | null } | null> {
    const row = await prisma.exchangeRate.findFirst({
      where: { currencyFrom, currencyTo: 'RUB' },
      orderBy: { fetchedAt: 'desc' },
    })
    if (!row) {
      return null
    }
    return { rate: row.rate.toString(), fetchedAt: row.fetchedAt, source: row.source }
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis?.quit().catch(() => undefined)
  }

  private getRedis(): Redis | null {
    const url = this.config.get<string>('REDIS_URL')
    if (!url) {
      return null
    }
    if (!this.redis) {
      this.redis = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: true })
    }
    return this.redis
  }
}
