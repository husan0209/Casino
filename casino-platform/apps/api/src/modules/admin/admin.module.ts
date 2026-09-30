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
  exports: [AdminFacade, AdminAuthGuard, AdminAuthService],
})
export class AdminModule {}
