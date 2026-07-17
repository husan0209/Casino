import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { WalletModule } from '../wallet/wallet.module'
import { ReferralsController } from './presentation/referrals.controller'
import { ReferralsAdminController } from './presentation/referrals-admin.controller'
import { ReferralCalcService } from './application/referral-calc.service'

@Module({
  imports: [AuthModule, WalletModule],
  controllers: [ReferralsController, ReferralsAdminController],
  providers: [ReferralCalcService],
  exports: [ReferralCalcService],
})
export class ReferralsModule {}
