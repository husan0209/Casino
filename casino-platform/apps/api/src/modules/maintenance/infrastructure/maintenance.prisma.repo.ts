import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'

import { prisma } from '@casino/database'

import { NOWPaymentsClient } from '../../payments/infrastructure/clients/nowpayments.client'
import { ExpireDepositsJob } from '../application/expire-deposits.job'
import { UpdateRatesJob } from '../application/update-rates.job'
import { WithdrawalReminderJob } from '../application/withdrawal-reminder.job'
import {
  type IExchangeRateWriter,
  type IPaymentMaintenanceRepo,
  type IReminderAuditRepo,
  type IRatesProvider,
  type MaintenanceHandlers,
  type MaintenancePaymentRow,
} from '../domain/maintenance.ports'

const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000'
const REMINDER_ACTION = 'maintenance.withdrawal_reminder'
const RATES_REDIS_KEY = 'exchange_rates:rub'
const RATES_CACHE_TTL_SECONDS = 300

/**
 * Map job.name → хендлер для воркера (GAP-33): repeatable-job по имени
 * выстреливает соответствующий application-класс.
 */
@Injectable()
export class PaymentJobHandlers {
  constructor(
    private readonly expire: ExpireDepositsJob,
    private readonly rates: UpdateRatesJob,
    private readonly reminder: WithdrawalReminderJob,
  ) {}

  get map(): Omit<MaintenanceHandlers, 'referral-daily'> {
    return {
      'expire-deposits': () => this.expire.execute(),
      'update-rates': () => this.rates.execute(),
      'withdrawal-reminder': () => this.reminder.execute(),
    }
  }
}

/** Prisma-реализация портов maintenance-задач (GAP-33). */
@Injectable()
export class PrismaMaintenanceRepo implements IPaymentMaintenanceRepo {
  async listPendingDeposits(): Promise<MaintenancePaymentRow[]> {
    const rows = await prisma.paymentRequest.findMany({
      where: { type: 'deposit', status: 'pending' },
      select: { id: true, createdAt: true, provider: true, expiresAt: true },
    })
    return rows.map((r) => ({ ...r, provider: String(r.provider) }))
  }

  async listPendingWithdrawals(): Promise<MaintenancePaymentRow[]> {
    const rows = await prisma.paymentRequest.findMany({
      where: { type: 'withdrawal', status: 'pending' },
      select: { id: true, createdAt: true, provider: true, expiresAt: true, amount: true, currency: true },
    })
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      provider: String(r.provider),
      expiresAt: r.expiresAt,
      amount: r.amount.toString(),
      currency: r.currency,
    }))
  }

  /** Условный update: гонка с вебхуком (completed) не затирает завершённый статус. */
  async markExpired(id: string): Promise<void> {
    const res = await prisma.paymentRequest.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'expired' },
    })
    if (res.count === 0) {
      throw new Error(`payment_request ${id} is not pending anymore`)
    }
  }
}

/** Audit-log как канал уведомления админов + дедуп напоминаний. */
@Injectable()
export class PrismaReminderAuditRepo implements IReminderAuditRepo {
  async findRecentReminder(withdrawalId: string, since: Date): Promise<boolean> {
    const row = await prisma.auditLog.findFirst({
      where: { action: REMINDER_ACTION, targetId: withdrawalId, createdAt: { gte: since } },
      select: { id: true },
    })
    return row !== null
  }

  async recordReminder(input: { targetId: string; adminsNotified: number; count: number }): Promise<void> {
    await prisma.auditLog.create({
      data: {
        actorType: 'system',
        actorId: SYSTEM_ACTOR_ID,
        action: REMINDER_ACTION,
        targetType: 'payment_request',
        targetId: input.targetId,
        payload: { adminsNotified: input.adminsNotified, totalStale: input.count },
      },
    })
  }

  async activeAdminEmails(): Promise<string[]> {
    const rows = await prisma.adminUser.findMany({
      where: { isActive: true },
      select: { email: true },
    })
    return rows.map((r) => r.email)
  }
}

/** Запись курсов: таблица exchange_rates (история) + Redis-кеш TTL 5 мин (best-effort). */
@Injectable()
export class PrismaExchangeRateWriter implements IExchangeRateWriter {
  private redis: Redis | null = null

  constructor(private readonly config: ConfigService) {}

  async saveRate(input: { currencyFrom: string; currencyTo: string; rate: string; source: string }): Promise<void> {
    await prisma.exchangeRate.create({ data: input })
  }

  /** Без Redis_URL (dev) кеш пропускается молча; сбой Redis — исключение наверх (job логирует warn). */
  async cacheRates(rates: Record<string, string>): Promise<void> {
    if (Object.keys(rates).length === 0) {
      return
    }
    const url = this.config.get<string>('REDIS_URL')
    if (!url) {
      return
    }
    if (!this.redis) {
      this.redis = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: true })
    }
    await this.redis.set(RATES_REDIS_KEY, JSON.stringify(rates), 'EX', RATES_CACHE_TTL_SECONDS)
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis?.quit().catch(() => {})
  }
}

/**
 * Провайдер курсов через NOWPayments /estimate (1 единица валюты → RUB).
 * В dev без ключа NOWPaymentsClient вернёт dev-stub по константам DISPLAY_RUB_RATES.
 */
@Injectable()
export class NowPaymentsRatesProvider implements IRatesProvider {
  constructor(private readonly client: NOWPaymentsClient) {}

  async estimateRub(currency: string): Promise<{ rate: string; source: string } | null> {
    const res = await this.client.estimate({ amount: '1', currencyFrom: currency, currencyTo: 'RUB' })
    if (!res) {
      return null
    }
    return { rate: res.estimatedAmount, source: res.source }
  }
}
