/**
 * Affiliate Module — партнёрская программа (ТЗ ч.8).
 *
 * ОтДЕЛЬНЫЙ МОДУЛЬ, а не расширение referrals: контрагент — внешний вебмастер
 * со своим аккаунтом, трекинг-ссылками, ставкой и начислениями, тогда как
 * referrals — программа «приведи друга» для игроков (ТЗ ч.8 §2).
 *
 * ЗАВИСИМОСТИ.
 *  - wallet  — единственный способ зачислить/списать комиссию.
 *  - users   — порт ResponsibleGamingHook (users объявляет порт, реализацию
 *              поставляем мы; обратной зависимости нет, цикла нет) И провижининг
 *              user-записи партнёра: `UsersFacade.provisionAffiliatePlayer` /
 *              `deprovisionAffiliatePlayer` (GAP-62 закрыт 2026-10-03 — запись
 *              в чужую таблицу `users` возвращена владельцу, межмодульное
 *              общение идёт только через фасад). В порту
 *              AFFILIATE_PLAYER_PROVISIONING_REPOSITORY остались только
 *              ЧТЕНИЯ чужих таблиц (referral_code, kyc_profiles) — они
 *              легализованы ADR GAP-51 и описаны в шапке
 *              `infrastructure/player-provisioning.prisma.repository.ts`.
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
import { CreateAffiliateByAdminUseCase } from './application/use-cases/create-affiliate-by-admin.use-case'
import { CreateCommissionUseCase } from './application/use-cases/create-commission.use-case'
import { CreditCommissionUseCase } from './application/use-cases/credit-commission.use-case'
import { LeaveAffiliateProgramUseCase } from './application/use-cases/leave-affiliate-program.use-case'
import { LoginAffiliateUseCase } from './application/use-cases/login-affiliate.use-case'
import { QualifyAttributionsUseCase } from './application/use-cases/qualify-attributions.use-case'
import { RegisterAffiliateUseCase } from './application/use-cases/register-affiliate.use-case'
import { TrackClickUseCase } from './application/use-cases/track-click.use-case'
import { UpdateAffiliateByAdminUseCase } from './application/use-cases/update-affiliate-by-admin.use-case'
import { UpdateAffiliateProfileUseCase } from './application/use-cases/update-affiliate-profile.use-case'
import { AFFILIATE_SETTINGS_REPOSITORY } from './domain/affiliate-settings'
import { AFFILIATE_JWT_SERVICE } from './domain/affiliate.ports'
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
    // После GAP-62 порт только читает чужие таблицы (referral_code / kyc),
    // поэтому реализация остаётся: Prisma-чтения наружу через фасад users
    // не проходят (kyc_profiles — не таблица users).
    {
      provide: AFFILIATE_PLAYER_PROVISIONING_REPOSITORY,
      useClass: PrismaPlayerProvisioningRepository,
    },
    // useExisting, а НЕ useClass: IpHasher обязан быть ОДНИМ экземпляром.
    // Соль/нормализация IP обязаны совпадать при записи клика и при проверке
    // атрибуции, иначе антифрод-правила F1/F3 молча перестанут срабатывать.
    { provide: AFFILIATE_IP_FINGERPRINTER, useExisting: IpHasher },
    // В5: application-слой (login/register) получает JWT партнёров только через
    // порт. useExisting — тот же экземпляр, что и у класс-токена, который
    // по-прежнему нужен presentation-guard'у (образец: auth.module.ts).
    { provide: AFFILIATE_JWT_SERVICE, useExisting: AffiliateJwtService },
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
    // В3: записи presentation-контроллеров (кабинет и admin-контур) идут
    // только через эти сценарии.
    CreateAffiliateByAdminUseCase,
    UpdateAffiliateByAdminUseCase,
    UpdateAffiliateProfileUseCase,
    LeaveAffiliateProgramUseCase,
    AffiliateClicksCleanupService,
    AffiliateAuthGuard,
    AffiliateFacade,
  ],
  // Наружу — только фасад (MODULE_TEMPLATE шаг 9) + JwtService/Guard для
  // собственных контроллеров.
  exports: [AffiliateFacade, AffiliateJwtService, AffiliateAuthGuard],
})
export class AffiliateModule {}
