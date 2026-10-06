import { Inject, Module, type OnApplicationBootstrap } from '@nestjs/common'

import { AdminModule } from '../admin/admin.module'
import { AffiliateModule } from '../affiliate/affiliate.module'
import { AuthModule } from '../auth/auth.module'
import { ReferralsModule } from '../referrals/referrals.module'
import { UsersModule } from '../users/users.module'
import { AffiliateClicksCleanupJob } from './application/affiliate-clicks-cleanup.job'
import { AffiliateDailyJob } from './application/affiliate-daily.job'
import { AffiliateQualificationJob } from './application/affiliate-qualification.job'
import { CleanupSessionsJob } from './application/cleanup-sessions.job'
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
  SESSION_MAINTENANCE_REPO,
  type MaintenanceHandlers,
} from './domain/maintenance.ports'
import { AffiliateJobHandlers } from './infrastructure/affiliate-job.handlers'
import {
  NowPaymentsRatesProvider,
  PaymentJobHandlers,
  PrismaExchangeRateWriter,
  PrismaMaintenanceRepo,
  PrismaReminderAuditRepo,
  PrismaSessionMaintenanceRepo,
} from './infrastructure/maintenance.prisma.repo'
import { MaintenanceWorker } from './infrastructure/maintenance.worker'
import { MaintenanceAdminController } from './presentation/maintenance-admin.controller'
import { MaintenanceScheduler } from '../../queues/infrastructure/maintenance.scheduler'
import { EMAIL_QUEUE_PORT } from '../../queues/queue.types'
import { QueuesModule } from '../../queues/queues.module'
import { PaymentsModule } from '../payments/payments.module'

/**
 * Scheduled jobs (GAP-33, ТЗ ч.3 §13): BullMQ-очередь `maintenance` с четырьмя
 * repeatable-job'ами (интервалы из env):
 * - expire-deposits (5 мин): pending-депозиты старше 2ч (крипто — по expires_at) → expired;
 * - update-rates (5 мин): курсы RUB → exchange_rates + Redis TTL 5 мин (потребители — GAP-34);
 * - withdrawal-reminder (1ч): письмо активным админам о выводах в pending >24ч (дедуп 24ч);
 * - referral-daily (24ч): запуск ReferralsFacade.runDaily (GAP-32; дедуп внутри).
 * Ручной триггер начислений — POST /admin/referrals/run-daily (superadmin, audit-log):
 * presentation-слой этого модуля (MaintenanceAdminController, решение В2; путь
 * сохранён после переезда из referrals).
 *
 * Зависимости: PaymentsModule — PaymentsFacade.estimateRub (курсы; В1: раньше
 * тянули NOWPaymentsClient напрямую), ReferralsModule — ReferralsFacade (В1:
 * раньше тянули ReferralCalcService из application/), AdminModule — AdminFacade
 * для трейла ручного запуска, EMAIL_QUEUE_PORT — из QueuesModule.
 * AdminModule/AuditLogService для напоминаний не нужен: дедуп/трейл пишутся
 * напрямую PrismaReminderAuditRepo (audit_logs).
 */
@Module({
  imports: [
    AuthModule,
    AdminModule,
    PaymentsModule,
    ReferralsModule,
    AffiliateModule,
    UsersModule,
    QueuesModule,
  ],
  controllers: [MaintenanceAdminController],
  providers: [
    MaintenanceScheduler,
    MaintenanceWorker,
    ExpireDepositsJob,
    UpdateRatesJob,
    WithdrawalReminderJob,
    ReferralDailyJob,
    CleanupSessionsJob,
    // AffiliateModule подключён из AffiliateModule; курсы берутся через
    // PaymentsFacade, поэтому NOWPaymentsClient в провайдерах больше не нужен.
    AffiliateDailyJob,
    AffiliateQualificationJob,
    AffiliateClicksCleanupJob,
    AffiliateJobHandlers,
    { provide: PAYMENT_MAINTENANCE_REPO, useClass: PrismaMaintenanceRepo },
    { provide: SESSION_MAINTENANCE_REPO, useClass: PrismaSessionMaintenanceRepo },
    { provide: REMINDER_AUDIT_REPO, useClass: PrismaReminderAuditRepo },
    { provide: EXCHANGE_RATE_WRITER, useClass: PrismaExchangeRateWriter },
    { provide: RATES_PROVIDER, useClass: NowPaymentsRatesProvider },
    { provide: MAINTENANCE_EMAIL_PORT, useExisting: EMAIL_QUEUE_PORT },
    PaymentJobHandlers,
    {
      provide: MAINTENANCE_HANDLERS,
      // referral-daily добавлен к map из PaymentJobHandlers (3 payment-задачи),
      // affiliate-задачи — из AffiliateJobHandlers (ещё 3, ТЗ ч.8 §15).
      useFactory: (
        paymentHandlers: PaymentJobHandlers,
        affiliateHandlers: AffiliateJobHandlers,
        referral: ReferralDailyJob,
      ): MaintenanceHandlers => ({
        ...paymentHandlers.map,
        ...affiliateHandlers.map,
        'referral-daily': () => referral.execute(),
      }),
      inject: [PaymentJobHandlers, AffiliateJobHandlers, ReferralDailyJob],
    },
  ],
})
export class MaintenanceModule implements OnApplicationBootstrap {
  constructor(@Inject(MaintenanceScheduler) private readonly scheduler: MaintenanceScheduler) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.scheduler.registerRepeatableJobs()
  }
}
