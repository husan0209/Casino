import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

// AdminAuthGuard (admin-JWT, reviewedBy -> AdminUser FK) экспортируется из AdminModule
import { AdminModule } from '../admin/admin.module'
import { AuthModule } from '../auth/auth.module'
import { GeoModule } from '../geo/geo.module'
import { GetKycStatusUseCase } from './application/use-cases/get-kyc-status.use-case'
import { KycCheckService } from './application/use-cases/kyc-check.service'
import { SubmitKycUseCase } from './application/use-cases/submit-kyc.use-case'
import { KYC_REPOSITORY } from './domain/repositories/kyc.repository'
import { PrismaKycRepository } from './infrastructure/repositories/kyc.prisma'
import { KycAdminController } from './presentation/controllers/kyc-admin.controller'
import { KycController } from './presentation/controllers/kyc.controller'

@Module({
  imports: [AdminModule, AuthModule, ConfigModule, GeoModule],
  controllers: [KycController, KycAdminController],
  providers: [
    { provide: KYC_REPOSITORY, useClass: PrismaKycRepository },
    SubmitKycUseCase,
    GetKycStatusUseCase,
    KycCheckService,
  ],
  exports: [KycCheckService],
})
export class KycModule {}
