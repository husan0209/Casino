import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { WalletModule } from '../wallet/wallet.module'
import { ReferralCalcService } from './application/referral-calc.service'
import { REFERRAL_REPOSITORY } from './domain/referral.repository'
import { PrismaReferralRepository } from './infrastructure/referral.prisma.repository'
import { ReferralsAdminController } from './presentation/referrals-admin.controller'
import { ReferralsController } from './presentation/referrals.controller'

@Module({
  imports: [AuthModule, WalletModule],
  controllers: [ReferralsController, ReferralsAdminController],
  providers: [ReferralCalcService, { provide: REFERRAL_REPOSITORY, useClass: PrismaReferralRepository }],
  exports: [ReferralCalcService],
})
export class ReferralsModule {}
