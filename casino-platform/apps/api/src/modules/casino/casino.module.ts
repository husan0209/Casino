import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

import { AdminModule } from '../admin/admin.module'
import { AuthModule } from '../auth/auth.module'
import { WalletModule } from '../wallet/wallet.module'
import { GameCallbackService } from './application/services/game-callback.service'
import { AdminSetGameFlagsUseCase } from './application/use-cases/admin-set-game-flags.use-case'
import { AdminSetProviderEnabledUseCase } from './application/use-cases/admin-set-provider-enabled.use-case'
import { AdminSyncProviderGamesUseCase } from './application/use-cases/admin-sync-provider-games.use-case'
import { AdminUpdateGameUseCase } from './application/use-cases/admin-update-game.use-case'
import { AztecSpinUseCase } from './application/use-cases/aztec-spin.use-case'
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
