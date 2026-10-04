import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'

import { prisma } from '@casino/database'

import { AdminFacade } from '../../admin/facade/admin.facade'
import { PaymentsFacade } from '../../payments/facade/payments.facade'
import { UsersFacade } from '../../users/facade/users.facade'
import { CleanupSessionsJob } from '../application/cleanup-sessions.job'
import { ExpireDepositsJob } from '../application/expire-deposits.job'
import { UpdateRatesJob } from '../application/update-rates.job'
import { WithdrawalReminderJob } from '../application/withdrawal-reminder.job'
import { PaymentRequestNotPendingError } from '../domain/errors'
import {
  type IExchangeRateWriter,
  type IPaymentMaintenanceRepo,
  type IReminderAuditRepo,
  type IRatesProvider,
  type ISessionMaintenanceRepo,
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
    @Inject(ExpireDepositsJob) private readonly expire: ExpireDepositsJob,
    @Inject(UpdateRatesJob) private readonly rates: UpdateRatesJob,
    @Inject(WithdrawalReminderJob) private readonly reminder: WithdrawalReminderJob,
    @Inject(CleanupSessionsJob) private readonly cleanupSessions: CleanupSessionsJob,
  ) {}

  /**
   * Задачи, диспетчеризуемые из этого класса.
   *
   * `referral-daily` и три affiliate-задачи добавляются в MaintenanceModule
   * через фабрику MAINTENANCE_HANDLERS — они требуют модулей, которые этот
   * класс не тянет. Тип отражает реальность: здесь их нет.
   */
  get map(): Omit<
    MaintenanceHandlers,
    'referral-daily' | 'affiliate-daily' | 'affiliate-qualification' | 'affiliate-clicks-cleanup'
  > {
    return {
      'expire-deposits': () => this.expire.execute(),
      'update-rates': () => this.rates.execute(),
      'withdrawal-reminder': () => this.reminder.execute(),
      'cleanup-sessions': () => this.cleanupSessions.execute(),
    }
  }
}

/**
 * Реализация портов maintenance-задач (GAP-33).
 *
 * Чужие таблицы — только через фасад владельца (гард G24): истечение заявки
 * делает payments, запись аудита — admin. Чтения (`payment_requests`,
 * `audit_logs`, `admin_users`) остались прямыми: межмодульное чтение разрешено
 * ADR GAP-51, и детектор записей его не считает.
 */
@Injectable()
export class PrismaMaintenanceRepo implements IPaymentMaintenanceRepo {
  constructor(@Inject(PaymentsFacade) private readonly payments: PaymentsFacade) {}

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
      select: {
        id: true,
        createdAt: true,
        provider: true,
        expiresAt: true,
        amount: true,
        currency: true,
      },
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

  /**
   * Условное истечение — внутри payments (`expirePendingPayment`), чтобы
   * гонка с вебхуком не затирала completed-статус. Здесь остаётся только
   * решение «нулём» — это доменная ошибка maintenance, а не payments.
   */
  async markExpired(id: string): Promise<void> {
    const flipped = await this.payments.expirePendingPayment(id)
    if (!flipped) {
      throw new PaymentRequestNotPendingError(id)
    }
  }
}

/**
 * Audit-log как канал уведомления админов + дедуп напоминаний.
 *
 * Запись строки `audit_logs` делает admin (гард G24) через `logActionStrict`:
 * именно строгий вариант, потому что строка здесь — состояние, а не только
 * наблюдаемость: по ней же решается, не слать ли напоминание повторно.
 */
@Injectable()
export class PrismaReminderAuditRepo implements IReminderAuditRepo {
  constructor(@Inject(AdminFacade) private readonly audit: AdminFacade) {}

  async findRecentReminder(withdrawalId: string, since: Date): Promise<boolean> {
    const row = await prisma.auditLog.findFirst({
      where: { action: REMINDER_ACTION, targetId: withdrawalId, createdAt: { gte: since } },
      select: { id: true },
    })
    return row !== null
  }

  async recordReminder(input: {
    targetId: string
    adminsNotified: number
    count: number
  }): Promise<void> {
    await this.audit.logActionStrict({
      actorType: 'system',
      actorId: SYSTEM_ACTOR_ID,
      action: REMINDER_ACTION,
      targetType: 'payment_request',
      targetId: input.targetId,
      payload: { adminsNotified: input.adminsNotified, totalStale: input.count },
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

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  async saveRate(input: {
    currencyFrom: string
    currencyTo: string
    rate: string
    source: string
  }): Promise<void> {
    await prisma.exchangeRate.create({ data: input })
  }

  /** Таблица чистится от записей старше cutoff: тики каждые 5 мин — иначе бесконечный рост. */
  async pruneHistory(olderThan: Date): Promise<void> {
    await prisma.exchangeRate.deleteMany({ where: { fetchedAt: { lt: olderThan } } })
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
    this.redis ??= new Redis(url, { maxRetriesPerRequest: null, lazyConnect: true })
    await this.redis.set(RATES_REDIS_KEY, JSON.stringify(rates), 'EX', RATES_CACHE_TTL_SECONDS)
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis?.quit().catch(() => {})
  }
}

/**
 * Провайдер курсов через PaymentsFacade → NOWPayments /estimate (1 единица валюты → RUB).
 * В dev без ключа NOWPaymentsClient вернёт dev-stub по константам DISPLAY_RUB_RATES.
 */
@Injectable()
export class NowPaymentsRatesProvider implements IRatesProvider {
  // PaymentsFacade, а не NOWPaymentsClient напрямую: межмодульный доступ только
  // через фасад (AGENTS.md правило 4). @Inject обязателен — в этой сборке
  // design:paramtypes не выдаётся (CONVENTIONS §1.4).
  constructor(@Inject(PaymentsFacade) private readonly facade: PaymentsFacade) {}

  async estimateRub(currency: string): Promise<{ rate: string; source: string } | null> {
    const res = await this.facade.estimateRub(currency)
    if (!res) {
      return null
    }
    return { rate: res.estimatedAmount, source: res.source }
  }
}

/**
 * Очистка мёртвых сессий (pre-launch hardening A1).
 *
 * Удаляет не maintenance: `sessions` — таблица auth/users (MODEL_OWNERS, гард
 * G24), поэтому заказ идёт через `UsersFacade.purgeDeadSessions`. Выбор cutoff
 * (grace-окно, чтобы admin-UI ещё видел недавние «выходы со всех устройств»)
 * остаётся за джобой — это решение планировщика, а не владельца строк.
 */
@Injectable()
export class PrismaSessionMaintenanceRepo implements ISessionMaintenanceRepo {
  constructor(@Inject(UsersFacade) private readonly users: UsersFacade) {}

  async purgeDeadSessions(cutoff: Date): Promise<number> {
    return this.users.purgeDeadSessions(cutoff)
  }
}
