import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Decimal } from 'decimal.js'
import Redis from 'ioredis'

import { type DemoSettlement, type IDemoBalanceStore } from '../../domain/demo-balance'

/**
 * Остаток хранится целым числом минимальных единиц: Lua считает числами с
 * плавающей точкой, и дробь в скрипт отдавать нельзя (0.1 + 0.2 там не сложится
 * в нужную копейку). 8 знаков — точность `DECIMAL(20,8)` из схемы.
 *
 * Граница по диапазону: демо стартует с 1000, максимальная ставка 10 000,
 * максимальный множитель ~1330 ⇒ остаток ≤ ~1.3e7, в минимальных единицах
 * ≤ 1.3e15 — внутри точного диапазона double (9.0e15).
 */
const MINOR_UNITS_EXPONENT = 8
const MINOR_SCALE = new Decimal(10).pow(MINOR_UNITS_EXPONENT)

/** Токен демо одноразовый, поэтому счёт живёт сутки после последнего броска. */
const DEMO_BALANCE_TTL_SECONDS = 24 * 60 * 60

/**
 * Проверка остатка и запись нового — одним скриптом, иначе два броска,
 * пришедшие одновременно, потратят одну и ту же ставку дважды.
 */
const SETTLE_SCRIPT = [
  "local raw = redis.call('GET', KEYS[1])",
  'local current = raw and tonumber(raw) or tonumber(ARGV[1])',
  'local bet = tonumber(ARGV[2])',
  'local win = tonumber(ARGV[3])',
  'if current < bet then',
  '  return {0, current}',
  'end',
  'local updated = current - bet + win',
  "redis.call('SET', KEYS[1], updated, 'EX', tonumber(ARGV[4]))",
  'return {1, updated}',
].join('\n')

function toMinorUnits(raw: string): string {
  return new Decimal(raw).toDecimalPlaces(MINOR_UNITS_EXPONENT).times(MINOR_SCALE).toString()
}

function fromMinorUnits(raw: string | number): string {
  return new Decimal(raw).div(MINOR_SCALE).toString()
}

@Injectable()
export class DemoBalanceRedisStore implements IDemoBalanceStore {
  private redis: Redis | null = null

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  async settle(args: {
    sessionToken: string
    startCredit: string
    bet: string
    win: string
  }): Promise<DemoSettlement> {
    const result = (await this.client().eval(
      SETTLE_SCRIPT,
      1,
      this.key(args.sessionToken),
      toMinorUnits(args.startCredit),
      toMinorUnits(args.bet),
      toMinorUnits(args.win),
      String(DEMO_BALANCE_TTL_SECONDS),
    )) as [string | number, string | number]

    return { accepted: Number(result[0]) === 1, balance: fromMinorUnits(result[1]) }
  }

  async peek(sessionToken: string, startCredit: string): Promise<string> {
    const stored = await this.client().get(this.key(sessionToken))
    return stored === null ? startCredit : fromMinorUnits(stored)
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis?.quit().catch(() => {})
  }

  private key(sessionToken: string): string {
    return `demo_balance:${sessionToken}`
  }

  private client(): Redis {
    const url = this.config.getOrThrow<string>('REDIS_URL')
    this.redis ??= new Redis(url, { maxRetriesPerRequest: null, lazyConnect: true })
    return this.redis
  }
}
