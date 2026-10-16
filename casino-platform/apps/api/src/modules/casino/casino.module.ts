import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

import { AdminModule } from '../admin/admin.module'
import { AuthModule } from '../auth/auth.module'
import { WalletModule } from '../wallet/wallet.module'
import { EngagementEngineService } from './application/services/engagement-engine.service'
import { EngagementMetricsService } from './application/services/engagement-metrics.service'
import { GameCallbackService } from './application/services/game-callback.service'
import { AdminSetGameFlagsUseCase } from './application/use-cases/admin-set-game-flags.use-case'
import { AdminSetProviderEnabledUseCase } from './application/use-cases/admin-set-provider-enabled.use-case'
import { AdminSyncProviderGamesUseCase } from './application/use-cases/admin-sync-provider-games.use-case'
import { AdminUpdateGameUseCase } from './application/use-cases/admin-update-game.use-case'
import { AztecSpinUseCase } from './application/use-cases/aztec-spin.use-case'
import { AdjustRtpUseCase } from './application/use-cases/engagement/adjust-rtp.use-case'
import { CalculateEngagementUseCase } from './application/use-cases/engagement/calculate-engagement.use-case'
import { CheckReactivationUseCase } from './application/use-cases/engagement/check-reactivation.use-case'
import { GenerateNearMissUseCase } from './application/use-cases/engagement/generate-near-miss.use-case'
import { SelectLdwUseCase } from './application/use-cases/engagement/select-ldw.use-case'
import { TrackBehaviorUseCase } from './application/use-cases/engagement/track-behavior.use-case'
import { FavoritesUseCase } from './application/use-cases/favorites.use-case'
import { LaunchGameUseCase } from './application/use-cases/launch-game.use-case'
import { ListGamesUseCase } from './application/use-cases/list-games.use-case'
import { OriginalsIconsUseCase } from './application/use-cases/originals-icons.use-case'
import { OriginalsSessionLoader } from './application/use-cases/originals-session-loader'
import { OriginalsSessionUseCase } from './application/use-cases/originals-session.use-case'
import { OriginalsSpinUseCase } from './application/use-cases/originals-spin.use-case'
import { PlinkoDropUseCase } from './application/use-cases/plinko-drop.use-case'
import { PROVIDER_ADAPTER_FACTORY } from './domain/casino.ports'
import { DEMO_BALANCE_STORE } from './domain/demo-balance'
import { HOUSE_SLOT_GAMES } from './domain/house-slot-game'
import {
  GAME_CATALOG_REPOSITORY,
  GAME_FAVORITES_REPOSITORY,
  GAME_PLAY_REPOSITORY,
  GAME_PROVIDER_REPOSITORY,
} from './domain/repositories/casino.repository'
import { ENGAGEMENT_CACHE } from './domain/repositories/engagement-cache.port'
import { ENGAGEMENT_REPOSITORY } from './domain/repositories/engagement.repository'
import { RedisEngagementCache } from './infrastructure/cache/engagement-cache.adapter'
import { DemoBalanceRedisStore } from './infrastructure/demo/demo-balance.redis'
import { DemoProviderAdapter } from './infrastructure/providers/demo/demo-provider.adapter'
import { HouseSlotGamesRegistry } from './infrastructure/providers/house/house-slot-games.registry'
import { ProviderAdapterFactory } from './infrastructure/providers/provider-adapter.factory'
import {
  PrismaGameCatalogRepository,
  PrismaGameFavoritesRepository,
  PrismaGamePlayRepository,
  PrismaGameProviderRepository,
} from './infrastructure/repositories/casino.prisma.repository'
import { PrismaEngagementRepository } from './infrastructure/repositories/engagement.prisma.repository'
import { AztecController } from './presentation/controllers/aztec.controller'
import { CasinoAdminController } from './presentation/controllers/casino-admin.controller'
import { CasinoController } from './presentation/controllers/casino.controller'
import { OriginalsController } from './presentation/controllers/originals.controller'
import { PlinkoController } from './presentation/controllers/plinko.controller'
import { ProviderCallbackController } from './presentation/controllers/provider-callback.controller'

@Module({
  imports: [ConfigModule, AuthModule, WalletModule, AdminModule],
  controllers: [
    CasinoController,
    ProviderCallbackController,
    CasinoAdminController,
    OriginalsController,
    PlinkoController,
    AztecController,
  ],
  providers: [
    // Класс-токен остаётся: presentation-контроллер provider-callback и
    // exports модуля пока внедряют фабрику напрямую (В3-остаток).
    // CasinoAdminController после В3 получает адаптеры только через порт
    // PROVIDER_ADAPTER_FACTORY — внутри AdminSyncProviderGamesUseCase.
    ProviderAdapterFactory,
    DemoProviderAdapter,
    // В5: application-слой получает infrastructure только через порты
    // (DI-токены). useExisting — тот же экземпляр, что и у класс-токена
    // (образец: payments.module.ts).
    { provide: PROVIDER_ADAPTER_FACTORY, useExisting: ProviderAdapterFactory },
    { provide: HOUSE_SLOT_GAMES, useClass: HouseSlotGamesRegistry },
    { provide: GAME_CATALOG_REPOSITORY, useClass: PrismaGameCatalogRepository },
    { provide: GAME_FAVORITES_REPOSITORY, useClass: PrismaGameFavoritesRepository },
    { provide: GAME_PLAY_REPOSITORY, useClass: PrismaGamePlayRepository },
    // В3: мутации админ-контура (enable/disable, gameCount, правки каталога)
    { provide: GAME_PROVIDER_REPOSITORY, useClass: PrismaGameProviderRepository },
    // Лицевой счёт демо-сессии: ставка списывается с него, а не пересчитывается
    // от стартового кредита на каждый бросок.
    { provide: DEMO_BALANCE_STORE, useClass: DemoBalanceRedisStore },
    // ТЗ ч.9: хранилище состояния/журнала движка и кэш Score (§6.4).
    { provide: ENGAGEMENT_REPOSITORY, useClass: PrismaEngagementRepository },
    { provide: ENGAGEMENT_CACHE, useClass: RedisEngagementCache },
    // UC-ENG-01…06 и движок §9.1. Выключается флагом ENGAGEMENT_ENABLED
    // (по умолчанию false — см. domain/engagement/engagement-config.ts).
    CalculateEngagementUseCase,
    AdjustRtpUseCase,
    CheckReactivationUseCase,
    SelectLdwUseCase,
    GenerateNearMissUseCase,
    TrackBehaviorUseCase,
    EngagementEngineService,
    // §11.1 — счётчики процесса и периодический снапшот в Pino (§11.2).
    EngagementMetricsService,
    GameCallbackService,
    LaunchGameUseCase,
    ListGamesUseCase,
    FavoritesUseCase,
    OriginalsSessionLoader,
    OriginalsSessionUseCase,
    OriginalsIconsUseCase,
    OriginalsSpinUseCase,
    PlinkoDropUseCase,
    AztecSpinUseCase,
    AdminSetProviderEnabledUseCase,
    AdminSyncProviderGamesUseCase,
    AdminUpdateGameUseCase,
    AdminSetGameFlagsUseCase,
  ],
  exports: [ProviderAdapterFactory],
})
export class CasinoModule {}
