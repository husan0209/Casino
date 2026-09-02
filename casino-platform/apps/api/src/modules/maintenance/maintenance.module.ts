import { Module, type OnApplicationBootstrap } from '@nestjs/common'

import { ReferralsModule } from '../referrals/referrals.module'
import { ExpireDepositsJob } from './application/expire-deposits.job'
import { ReferralDailyJob } from './application/referral-daily.job'
import { UpdateRatesJob } from './application/update-rates.job'
import { WithdrawalReminderJob } from './application/withdrawal-reminder.job'
import {
  EXCHANGE_RATE_WRITER,
  MAINTENANCE_EMAIL_PORT,
  MAINTENANCE_HANDLERS,
  PAYMENT_MAINTENANCE_REPO,
  RATES_PROVIDER,
  REMINDER_AUDIT_REPO,
  type MaintenanceHandlers,
} from './domain/maintenance.ports'
import {
  NowPaymentsRatesProvider,
  PaymentJobHandlers,
  PrismaExchangeRateWriter,
  PrismaMaintenanceRepo,
  PrismaReminderAuditRepo,
} from './infrastructure/maintenance.prisma.repo'
import { MaintenanceWorker } from './infrastructure/maintenance.worker'
import { MaintenanceScheduler } from '../../queues/infrastructure/maintenance.scheduler'
import { EMAIL_QUEUE_PORT } from '../../queues/queue.types'
import { QueuesModule } from '../../queues/queues.module'
import { NOWPaymentsClient } from '../payments/infrastructure/clients/nowpayments.client'

/**
 * Scheduled jobs (GAP-33, ТЗ ч.3 §13): BullMQ-очередь `maintenance` с четырьмя
 * repeatable-job'ами (интервалы из env):
 * - expire-deposits (5 мин): pending-депозиты старше 2ч (крипто — по expires_at) → expired;
 * - update-rates (5 мин): курсы RUB → exchange_rates + Redis TTL 5 мин (потребители — GAP-34);
 * - withdrawal-reminder (1ч): письмо активным админам о выводах в pending >24ч (дедуп 24ч);
 * - referral-daily (24ч): запуск ReferralCalcService.runDaily (GAP-32; дедуп внутри).
 * Ручной триггер начислений — POST /admin/referrals/run-daily (superadmin, audit-log).
 *
 * Зависимости: NOWPaymentsClient (для курсов) предоставляется локально,
 * ReferralsModule — ReferralCalcService; EMAIL_QUEUE_PORT — из QueuesModule.
 * AdminModule (AuditLogService) не нужен: дедуп/трейл напоминаний пишутся
 * напрямую PrismaReminderAuditRepo (audit_logs).
 */
@Module({
  imports: [ReferralsModule, QueuesModule],
  providers: [
    MaintenanceScheduler,
    MaintenanceWorker,
    ExpireDepositsJob,
    UpdateRatesJob,
    WithdrawalReminderJob,
    ReferralDailyJob,
    NOWPaymentsClient,
    { provide: PAYMENT_MAINTENANCE_REPO, useClass: PrismaMaintenanceRepo },
    { provide: REMINDER_AUDIT_REPO, useClass: PrismaReminderAuditRepo },
    { provide: EXCHANGE_RATE_WRITER, useClass: PrismaExchangeRateWriter },
    { provide: RATES_PROVIDER, useClass: NowPaymentsRatesProvider },
    { provide: MAINTENANCE_EMAIL_PORT, useExisting: EMAIL_QUEUE_PORT },
    {
      provide: MAINTENANCE_HANDLERS,
      // referral-daily добавлен к map из PaymentJobHandlers (3 payment-задачи)
      useFactory: (h: PaymentJobHandlers, referral: ReferralDailyJob): MaintenanceHandlers => ({
        ...h.map,
        'referral-daily': () => referral.execute(),
      }),
      inject: [PaymentJobHandlers, ReferralDailyJob],
    },
  ],
})
export class MaintenanceModule implements OnApplicationBootstrap {
  constructor(private readonly scheduler: MaintenanceScheduler) {}

  async onApplicationBootstrap() {
    await this.scheduler.registerRepeatableJobs()
  }
}
