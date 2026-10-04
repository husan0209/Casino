import { Module } from '@nestjs/common'

import { AdminAuthModule } from './admin-auth.module'
import { PaymentsModule } from '../payments/payments.module'
import { WalletModule } from '../wallet/wallet.module'
import { AdminBroadcastService } from './application/admin-broadcast.service'
import { AdminSettingsService } from './application/admin-settings.service'
import { AdminUsersService } from './application/admin-users.service'
import { AuditLogService } from './application/audit-log.service'
import { DashboardService } from './application/dashboard.service'
import {
  ADMIN_USER_REPOSITORY,
  AUDIT_LOG_REPOSITORY,
  DASHBOARD_REPOSITORY,
} from './domain/admin.repository'
import { ADMIN_BROADCAST_REPOSITORY, SYSTEM_SETTING_REPOSITORY } from './domain/system.repository'
import { WITHDRAWAL_REQUEST_STORE } from './domain/withdrawal.repository'
import { AdminFacade } from './facade/admin.facade'
import {
  PrismaAdminBroadcastRepository,
  PrismaSystemSettingRepository,
} from './infrastructure/admin-system.prisma.repository'
import {
  PrismaAdminUserRepository,
  PrismaAuditLogRepository,
  PrismaDashboardRepository,
} from './infrastructure/repositories/admin.prisma.repository'
import { PaymentsFacadeWithdrawalGateway } from './infrastructure/withdrawal-payments.gateway'
import { AdminAdminsController } from './presentation/controllers/admin-admins.controller'
import { AdminAuditController } from './presentation/controllers/admin-audit.controller'
import { AdminAuthController } from './presentation/controllers/admin-auth.controller'
import { AdminDashboardController } from './presentation/controllers/admin-dashboard.controller'
import { AdminFinanceController } from './presentation/controllers/admin-finance.controller'
import { AdminNotificationsController } from './presentation/controllers/admin-notifications.controller'
import { AdminSettingsController } from './presentation/controllers/admin-settings.controller'
import { AdminUsersController } from './presentation/controllers/admin-users.controller'

@Module({
  // PaymentsModule нужен ради PaymentsFacade: решение по заявке на вывод
  // (approve/reject) admin делает через публичный API владельца таблицы, а не
  // через её порт и Prisma-класс (гвард G16). Цикла нет, потому что вход в
  // админку живёт в AdminAuthModule, и kyc больше не тянет AdminModule.
  imports: [WalletModule, PaymentsModule, AdminAuthModule],
  controllers: [
    AdminAuthController,
    AdminUsersController,
    AdminAuditController,
    AdminAdminsController,
    AdminFinanceController,
    AdminDashboardController,
    AdminSettingsController,
    AdminNotificationsController,
  ],
  providers: [
    // AdminAuthService/AdminAuthGuard больше не здесь: они в AdminAuthModule,
    // иначе два экземпляра на один AppModule. Ниже они же и экспортируются —
    // через импорт AdminAuthModule, чтобы внешние потребители (affiliate-admin)
    // не менялись.
    { provide: ADMIN_USER_REPOSITORY, useClass: PrismaAdminUserRepository },
    { provide: AUDIT_LOG_REPOSITORY, useClass: PrismaAuditLogRepository },
    // Порт заявок на вывод — СВОЙ токен admin (domain/withdrawal.repository),
    // реализация ходит в PaymentsFacade. Раньше здесь стоял
    // { provide: PAYMENT_REQUEST_REPOSITORY, useClass: PaymentRequestRepository },
    // то есть admin импортировал токен и Prisma-класс чужого модуля (гвард G16)
    // и давал контроллеру всю поверхность репозитория вместо двух методов.
    { provide: WITHDRAWAL_REQUEST_STORE, useClass: PaymentsFacadeWithdrawalGateway },
    { provide: DASHBOARD_REPOSITORY, useClass: PrismaDashboardRepository },
    // Настройки/шаблоны и массовая рассылка (В3). До этого коммита сервисы и
    // порты были объявлены, но не подключены: Nest не резолвил
    // SYSTEM_SETTING_REPOSITORY / ADMIN_BROADCAST_REPOSITORY, а оба
    // контроллера не стояли в controllers — /admin/settings и
    // /admin/notifications/send отдавали 404, хотя apps/admin дергает их
    // (dashboard/settings/page.tsx).
    { provide: SYSTEM_SETTING_REPOSITORY, useClass: PrismaSystemSettingRepository },
    { provide: ADMIN_BROADCAST_REPOSITORY, useClass: PrismaAdminBroadcastRepository },
    AuditLogService,
    AdminFacade,
    AdminUsersService,
    DashboardService,
    AdminSettingsService,
    AdminBroadcastService,
  ],
  // Наружу отдаём фасад, AuditLogService и AdminAuthModule целиком.
  // Guard и сервис напрямую не экспортируются: их провайдер — AdminAuthModule,
  // а Nest умеет переэкспортировать только целый импорт, но не провайдер чужого
  // модуля (иначе «Nest cannot export a provider … not a part of the module»
  // на старте контейнера — это падение видно только в DI-графе, не в tsc).
  // AdminAuthService нужен наружу вместе с guard'ом: guard инжектит его, и без
  // переэкспорта падали импортирующие модули (E2E, PR #15).
  // AuditLogService оставляем прямым экспортом осознанно: maintenance пока
  // legacy-потребитель и импортирует сервис напрямую (долг учтён в
  // tech-debt/cross-module-imports.txt), removal сломал бы DI только на E2E.
  exports: [AdminFacade, AuditLogService, AdminAuthModule],
})
export class AdminModule {}
