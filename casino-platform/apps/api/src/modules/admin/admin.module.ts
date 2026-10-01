import { Module } from '@nestjs/common'

import { AdminUsersService } from './application/admin-users.service'
import { AuditLogService } from './application/audit-log.service'
import { DashboardService } from './application/dashboard.service'
import {
  ADMIN_USER_REPOSITORY,
  AUDIT_LOG_REPOSITORY,
  DASHBOARD_REPOSITORY,
} from './domain/admin.repository'
import { AdminFacade } from './facade/admin.facade'
import { AdminAuthService } from './infrastructure/admin-jwt.service'
import {
  PrismaAdminUserRepository,
  PrismaAuditLogRepository,
  PrismaDashboardRepository,
} from './infrastructure/repositories/admin.prisma.repository'
import { AdminAuthGuard } from './presentation/admin-auth.guard'
import { PAYMENT_REQUEST_REPOSITORY } from '../payments/domain/payments.ports'
import { WalletModule } from '../wallet/wallet.module'
import { AdminAdminsController } from './presentation/controllers/admin-admins.controller'
import { AdminAuditController } from './presentation/controllers/admin-audit.controller'
import { AdminAuthController } from './presentation/controllers/admin-auth.controller'
import { AdminDashboardController } from './presentation/controllers/admin-dashboard.controller'
import { AdminFinanceController } from './presentation/controllers/admin-finance.controller'
import { AdminUsersController } from './presentation/controllers/admin-users.controller'
import { PaymentRequestRepository } from '../payments/infrastructure/repositories/payment-request.repository'


@Module({
  imports: [WalletModule],
  controllers: [
    AdminAuthController,
    AdminUsersController,
    AdminAuditController,
    AdminAdminsController,
    AdminFinanceController,
    AdminDashboardController,
  ],
  providers: [
    AdminAuthService,
    AdminAuthGuard,
    { provide: ADMIN_USER_REPOSITORY, useClass: PrismaAdminUserRepository },
    { provide: AUDIT_LOG_REPOSITORY, useClass: PrismaAuditLogRepository },
    // Порт payments-домена: admin-finance инжектит IPaymentRequestRepository (В3)
    { provide: PAYMENT_REQUEST_REPOSITORY, useClass: PaymentRequestRepository },
    { provide: DASHBOARD_REPOSITORY, useClass: PrismaDashboardRepository },
    AuditLogService,
    AdminFacade,
    AdminUsersService,
    DashboardService,
    PaymentRequestRepository,
  ],
  // AdminAuthService экспортируем вместе с AdminAuthGuard: guard инжектит его,
  // и без экспорта импортирующие модули (KycModule) падали на DI (E2E, PR #15)
  // наружу отдаём фасад: прямой доступ к AuditLogService из других модулей
  // считается межмодульным долгом (гвард G16, AGENTS.md правило 4).
  // Наружу отдаём и фасад, и сам AuditLogService: фасад — sanctioned-путь для
  // новых модулей (правило 4, гвард G16), а maintenance пока остаётся
  // legacy-потребителем и импортирует сервис напрямую (его долг учтён в
  // tech-debt/cross-module-imports.txt). Убрать сервис из exports нельзя —
  // Nest перестанет резолвить MaintenanceAdminController, и это видно только
  // на E2E-прогоне с реальной БД.
  exports: [AdminFacade, AuditLogService, AdminAuthGuard, AdminAuthService],
})
export class AdminModule {}
