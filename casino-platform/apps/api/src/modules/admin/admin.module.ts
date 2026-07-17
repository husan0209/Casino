import { Module } from '@nestjs/common'
import { AdminAuthController } from './presentation/controllers/admin-auth.controller'
import { AdminUsersController } from './presentation/controllers/admin-users.controller'
import { AdminAuditController } from './presentation/controllers/admin-audit.controller'
import { AdminAdminsController } from './presentation/controllers/admin-admins.controller'
import { AdminFinanceController } from './presentation/controllers/admin-finance.controller'
import { AdminAuthService } from './infrastructure/admin-jwt.service'
import { AdminAuthGuard } from './presentation/admin-auth.guard'
import { AuditLogService } from './application/audit-log.service'
import { AdminUsersService } from './application/admin-users.service'
import { WalletModule } from '../wallet/wallet.module'
import { PaymentRequestRepository } from '../payments/infrastructure/repositories/payment-request.repository'

@Module({
  imports: [WalletModule],
  controllers: [AdminAuthController, AdminUsersController, AdminAuditController, AdminAdminsController, AdminFinanceController],
  providers: [AdminAuthService, AdminAuthGuard, AuditLogService, AdminUsersService, PaymentRequestRepository],
  exports: [AuditLogService, AdminAuthGuard],
})
export class AdminModule {}
