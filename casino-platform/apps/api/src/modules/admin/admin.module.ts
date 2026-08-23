import { Module } from '@nestjs/common'
import { AdminAuthController } from './presentation/controllers/admin-auth.controller'
import { AdminUsersController } from './presentation/controllers/admin-users.controller'
import { AdminAuditController } from './presentation/controllers/admin-audit.controller'
import { AdminAdminsController } from './presentation/controllers/admin-admins.controller'
import { AdminFinanceController } from './presentation/controllers/admin-finance.controller'
import { AdminDashboardController } from './presentation/controllers/admin-dashboard.controller'
import { AdminAuthService } from './infrastructure/admin-jwt.service'
import { AdminAuthGuard } from './presentation/admin-auth.guard'
import { AuditLogService } from './application/audit-log.service'
import { AdminUsersService } from './application/admin-users.service'
import { DashboardService } from './application/dashboard.service'
import { WalletModule } from '../wallet/wallet.module'
import { PaymentRequestRepository } from '../payments/infrastructure/repositories/payment-request.repository'

@Module({
  imports: [WalletModule],
  controllers: [AdminAuthController, AdminUsersController, AdminAuditController, AdminAdminsController, AdminFinanceController, AdminDashboardController],
  providers: [AdminAuthService, AdminAuthGuard, AuditLogService, AdminUsersService, DashboardService, PaymentRequestRepository],
  exports: [AuditLogService, AdminAuthGuard],
})
export class AdminModule {}
