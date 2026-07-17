import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { WalletController } from './presentation/controllers/wallet.controller'
import { WalletFacade } from './application/wallet.facade'
import { PrismaWalletRepository, PrismaWalletLedger } from './infrastructure/repositories/wallet.prisma'
import { WALLET_REPOSITORY, WALLET_LEDGER } from './domain/repositories/wallet.repository'

@Module({
  imports: [AuthModule],
  controllers: [WalletController],
  providers: [
    WalletFacade,
    { provide: WALLET_REPOSITORY, useClass: PrismaWalletRepository },
    { provide: WALLET_LEDGER, useClass: PrismaWalletLedger },
  ],
  exports: [WalletFacade],
})
export class WalletModule {}
