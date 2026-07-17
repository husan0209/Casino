import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AuthModule } from '../../auth/auth.module'
import { WalletModule } from '../../wallet/wallet.module'
import { ProviderAdapterFactory } from './infrastructure/providers/provider-adapter.factory'
import { DemoProviderAdapter } from './infrastructure/providers/demo/demo-provider.adapter'
import { GameCallbackService } from './application/services/game-callback.service'
import { LaunchGameUseCase } from './application/use-cases/launch-game.use-case'
import { ListGamesUseCase } from './application/use-cases/list-games.use-case'
import { CasinoController } from './presentation/controllers/casino.controller'
import { ProviderCallbackController } from './presentation/controllers/provider-callback.controller'

@Module({
  imports: [ConfigModule, AuthModule, WalletModule],
  controllers: [CasinoController, ProviderCallbackController],
  providers: [
    ProviderAdapterFactory, DemoProviderAdapter,
    GameCallbackService, LaunchGameUseCase, ListGamesUseCase,
  ],
  exports: [ProviderAdapterFactory],
})
export class CasinoModule {}
