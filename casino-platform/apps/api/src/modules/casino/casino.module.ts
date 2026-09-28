import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

import { AdminModule } from '../admin/admin.module'
import { AuthModule } from '../auth/auth.module'
import { WalletModule } from '../wallet/wallet.module'
import { GameCallbackService } from './application/services/game-callback.service'
import { FavoritesUseCase } from './application/use-cases/favorites.use-case'
import { LaunchGameUseCase } from './application/use-cases/launch-game.use-case'
import { ListGamesUseCase } from './application/use-cases/list-games.use-case'
import { PROVIDER_ADAPTER_FACTORY } from './domain/casino.ports'
import {
  GAME_CATALOG_REPOSITORY,
  GAME_FAVORITES_REPOSITORY,
  GAME_PLAY_REPOSITORY,
} from './domain/repositories/casino.repository'
import { DemoProviderAdapter } from './infrastructure/providers/demo/demo-provider.adapter'
import { ProviderAdapterFactory } from './infrastructure/providers/provider-adapter.factory'
import {
  PrismaGameCatalogRepository,
  PrismaGameFavoritesRepository,
  PrismaGamePlayRepository,
} from './infrastructure/repositories/casino.prisma.repository'
import { CasinoAdminController } from './presentation/controllers/casino-admin.controller'
import { CasinoController } from './presentation/controllers/casino.controller'
import { ProviderCallbackController } from './presentation/controllers/provider-callback.controller'

@Module({
  imports: [ConfigModule, AuthModule, WalletModule, AdminModule],
  controllers: [CasinoController, ProviderCallbackController, CasinoAdminController],
  providers: [
    // Класс-токен остаётся: presentation-контроллеры (casino-admin,
    // provider-callback) и exports модуля пока внедряют фабрику напрямую.
    ProviderAdapterFactory,
    DemoProviderAdapter,
    // В5: application-слой получает infrastructure только через порты
    // (DI-токены). useExisting — тот же экземпляр, что и у класс-токена
    // (образец: payments.module.ts).
    { provide: PROVIDER_ADAPTER_FACTORY, useExisting: ProviderAdapterFactory },
    { provide: GAME_CATALOG_REPOSITORY, useClass: PrismaGameCatalogRepository },
    { provide: GAME_FAVORITES_REPOSITORY, useClass: PrismaGameFavoritesRepository },
    { provide: GAME_PLAY_REPOSITORY, useClass: PrismaGamePlayRepository },
    GameCallbackService,
    LaunchGameUseCase,
    ListGamesUseCase,
    FavoritesUseCase,
  ],
  exports: [ProviderAdapterFactory],
})
export class CasinoModule {}
