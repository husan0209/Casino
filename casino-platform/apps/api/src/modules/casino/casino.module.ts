import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

import { AdminModule } from '../admin/admin.module'
import { AuthModule } from '../auth/auth.module'
import { WalletModule } from '../wallet/wallet.module'
import { GameCallbackService } from './application/services/game-callback.service'
import { FavoritesUseCase } from './application/use-cases/favorites.use-case'
import { LaunchGameUseCase } from './application/use-cases/launch-game.use-case'
import { ListGamesUseCase } from './application/use-cases/list-games.use-case'
import { DemoProviderAdapter } from './infrastructure/providers/demo/demo-provider.adapter'
import { ProviderAdapterFactory } from './infrastructure/providers/provider-adapter.factory'
import { CasinoAdminController } from './presentation/controllers/casino-admin.controller'
import { CasinoController } from './presentation/controllers/casino.controller'
import { ProviderCallbackController } from './presentation/controllers/provider-callback.controller'

@Module({
  imports: [ConfigModule, AuthModule, WalletModule, AdminModule],
  controllers: [CasinoController, ProviderCallbackController, CasinoAdminController],
  providers: [
    ProviderAdapterFactory,
    DemoProviderAdapter,
    GameCallbackService,
    LaunchGameUseCase,
    ListGamesUseCase,
    FavoritesUseCase,
  ],
  exports: [ProviderAdapterFactory],
})
export class CasinoModule {}
