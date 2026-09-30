/**
 * Affiliate Module — партнёрская программа (ТЗ ч.8).
 *
 * ОтДЕЛЬНЫЙ МОДУЛЬ, а не расширение referrals: контрагент — внешний вебмастер
 * со своим аккаунтом, трекинг-ссылками, ставкой и начислениями, тогда как
 * referrals — программа «приведи друга» для игроков (ТЗ ч.8 §2).
 *
 * ЗАВИСИМОСТИ.
 *  - wallet  — единственный способ зачислить/списать комиссию.
 *  - users   — ТОЛЬКО ради порта ResponsibleGamingHook: users объявляет порт,
 *              его реализацию поставляем мы. Обратной зависимости нет, цикла нет.
 *  - auth    — AuthGuard/RolesGuard по конвенции модулей (MODULE_BOUNDARIES §2.4).
 */
import { Module } from '@nestjs/common'

import { RESPONSIBLE_GAMING_HOOK } from '../../common/ports/responsible-gaming-hook'
import { AdminModule } from '../admin/admin.module'
import { AuthModule } from '../auth/auth.module'
import { UsersModule } from '../users/users.module'
import { WalletModule } from '../wallet/wallet.module'
import { AffiliateClicksCleanupService } from './application/affiliate-clicks-cleanup.service'
import { AffiliateSettingsService } from './application/affiliate-settings.service'
import { AffiliateDailyRunUseCase } from './application/use-cases/affiliate-daily-run.use-case'
import { AttributePlayerUseCase } from './application/use-cases/attribute-player.use-case'
import { ClawbackPlayerCommissionsUseCase } from './application/use-cases/clawback-player-commissions.use-case'
import { CreateCommissionUseCase } from './application/use-cases/create-commission.use-case'
import { CreditCommissionUseCase } from './application/use-cases/credit-commission.use-case'
import { LoginAffiliateUseCase } from './application/use-cases/login-affiliate.use-case'
import { QualifyAttributionsUseCase } from './application/use-cases/qualify-attributions.use-case'
import { RegisterAffiliateUseCase } from './application/use-cases/register-affiliate.use-case'
import { TrackClickUseCase } from './application/use-cases/track-click.use-case'
import { AFFILIATE_SETTINGS_REPOSITORY } from './domain/affiliate-settings'
import {
  AFFILIATE_ATTRIBUTION_REPOSITORY,
  AFFILIATE_CLICK_REPOSITORY,
  AFFILIATE_COMMISSION_REPOSITORY,
  AFFILIATE_GAME_ACTIVITY_REPOSITORY,
  AFFILIATE_IP_FINGERPRINTER,
  AFFILIATE_PLAYER_PROVISIONING_REPOSITORY,
  AFFILIATE_REPOSITORY,
} from './domain/repositories/affiliate.repository'
import { AffiliateFacade } from './facade/affiliate.facade'
import { AffiliateJwtService } from './infrastructure/affiliate-jwt.service'
import { PrismaAffiliateSettingsRepository } from './infrastructure/affiliate-settings.prisma.repository'
import {
  PrismaAffiliateAttributionRepository,
  PrismaAffiliateClickRepository,
  PrismaAffiliateCommissionRepository,
  PrismaAffiliateRepository,
  PrismaGameActivityRepository,
} from './infrastructure/affiliate.prisma.repository'
import { IpHasher } from './infrastructure/ip-hasher'
import { PrismaPlayerProvisioningRepository } from './infrastructure/player-provisioning.prisma.repository'
import { AffiliateResponsibleGamingHook } from './infrastructure/responsible-gaming.hook'
import { AffiliateAdminController } from './presentation/controllers/affiliate-admin.controller'
import { AffiliateAuthController } from './presentation/controllers/affiliate-auth.controller'
import { AffiliateTrackingController } from './presentation/controllers/affiliate-tracking.controller'
import { AffiliateController } from './presentation/controllers/affiliate.controller'
import { AffiliateAuthGuard } from './presentation/guards/affiliate-auth.guard'

@Module({
  imports: [AuthModule, WalletModule, AdminModule, UsersModule],
  controllers: [
    AffiliateTrackingController,
    AffiliateAuthController,
    AffiliateController,
    AffiliateAdminController,
  ],
  providers: [
    // Реализации портов
    { provide: AFFILIATE_REPOSITORY, useClass: PrismaAffiliateRepository },
    { provide: AFFILIATE_CLICK_REPOSITORY, useClass: PrismaAffiliateClickRepository },
    { provide: AFFILIATE_ATTRIBUTION_REPOSITORY, useClass: PrismaAffiliateAttributionRepository },
    { provide: AFFILIATE_COMMISSION_REPOSITORY, useClass: PrismaAffiliateCommissionRepository },
    { provide: AFFILIATE_GAME_ACTIVITY_REPOSITORY, useClass: PrismaGameActivityRepository },
    { provide: AFFILIATE_SETTINGS_REPOSITORY, useClass: PrismaAffiliateSettingsRepository },
    {
      provide: AFFILIATE_PLAYER_PROVISIONING_REPOSITORY,
      useClass: PrismaPlayerProvisioningRepository,
    },
    // useExisting, а НЕ useClass: IpHasher обязан быть ОДНИМ экземпляром.
    // Соль/нормализация IP обязаны совпадать при записи клика и при проверке
    // атрибуции, иначе антифрод-правила F1/F3 молча перестанут срабатывать.
    { provide: AFFILIATE_IP_FINGERPRINTER, useExisting: IpHasher },
    // Мы же реализуем порт users — поэтому тут, а не в UsersModule:
    // так users не зависит от affiliate (зависимость через порт односторонняя).
    { provide: RESPONSIBLE_GAMING_HOOK, useExisting: AffiliateResponsibleGamingHook },
    // Сервисы и use cases
    IpHasher,
    AffiliateSettingsService,
    AffiliateJwtService,
    AffiliateResponsibleGamingHook,
    TrackClickUseCase,
    AttributePlayerUseCase,
    CreateCommissionUseCase,
    CreditCommissionUseCase,
    AffiliateDailyRunUseCase,
    ClawbackPlayerCommissionsUseCase,
    RegisterAffiliateUseCase,
    LoginAffiliateUseCase,
    QualifyAttributionsUseCase,
    AffiliateClicksCleanupService,
    AffiliateAuthGuard,
    AffiliateFacade,
  ],
  // Наружу — только фасад (MODULE_TEMPLATE шаг 9) + JwtService/Guard для
  // собственных контроллеров.
  exports: [AffiliateFacade, AffiliateJwtService, AffiliateAuthGuard],
})
export class AffiliateModule {}
