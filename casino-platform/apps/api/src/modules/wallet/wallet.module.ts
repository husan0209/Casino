import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { WalletFacade } from './application/wallet.facade'
import { WALLET_REPOSITORY, WALLET_LEDGER } from './domain/repositories/wallet.repository'
import { PrismaWalletRepository, PrismaWalletLedger } from './infrastructure/ledger/wallet.ledger.prisma'
import { WalletController } from './presentation/controllers/wallet.controller'

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
