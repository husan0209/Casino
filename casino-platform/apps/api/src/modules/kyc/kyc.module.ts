import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { KycController } from './presentation/controllers/kyc.controller'
import { KycAdminController } from './presentation/controllers/kyc-admin.controller'
import { PrismaKycRepository } from './infrastructure/repositories/kyc.prisma'
import { KYC_REPOSITORY } from './domain/repositories/kyc.repository'
import { SubmitKycUseCase } from './application/use-cases/submit-kyc.use-case'
import { GetKycStatusUseCase } from './application/use-cases/get-kyc-status.use-case'
import { KycCheckService } from './application/use-cases/kyc-check.service'
@Module({
  imports: [AuthModule],
  controllers: [KycController, KycAdminController],
  providers: [
    { provide: KYC_REPOSITORY, useClass: PrismaKycRepository },
    SubmitKycUseCase, GetKycStatusUseCase, KycCheckService,
  ],
  exports: [KycCheckService],
})
export class KycModule {}
