import { Module } from '@nestjs/common'

import { AdminModule } from '../admin/admin.module'
import { AuthModule } from '../auth/auth.module'
import { WalletModule } from '../wallet/wallet.module'
import { ReferralCalcService } from './application/referral-calc.service'
import { REFERRAL_REPOSITORY } from './domain/referral.repository'
import { ReferralsFacade } from './facade/referrals.facade'
import { PrismaReferralRepository } from './infrastructure/referral.prisma.repository'
import { ReferralsAdminController } from './presentation/referrals-admin.controller'
import { ReferralsController } from './presentation/referrals.controller'

@Module({
  imports: [AuthModule, WalletModule, AdminModule],
  controllers: [ReferralsController, ReferralsAdminController],
  providers: [
    ReferralCalcService,
    ReferralsFacade,
    { provide: REFERRAL_REPOSITORY, useClass: PrismaReferralRepository },
  ],
  // Наружу только фасад (MODULE_TEMPLATE Шаг 8): ReferralCalcService больше не
  // экспортируется — его единственные внешние потребители (job `referral-daily`
  // и admin-триггер в maintenance) переведены на ReferralsFacade, и возврат
  // сервиса в exports вернул бы межмодульный deep-импорт.
  exports: [ReferralsFacade],
})
export class ReferralsModule {}
