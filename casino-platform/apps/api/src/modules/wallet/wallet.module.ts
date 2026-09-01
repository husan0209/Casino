import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { ConfirmWithdrawalUseCase } from './application/use-cases/confirm-withdrawal.use-case'
import { LockFundsUseCase } from './application/use-cases/lock-funds.use-case'
import { UnlockFundsUseCase } from './application/use-cases/unlock-funds.use-case'
import { WalletFacade } from './application/wallet.facade'
import {
  WALLET_REPOSITORY,
  WALLET_LEDGER,
  WALLET_TRANSACTION_RUNNER,
} from './domain/repositories/wallet.repository'
import { PrismaWalletTransactionRunner } from './infrastructure/ledger/wallet-transaction-runner.prisma'
import {
  PrismaWalletRepository,
  PrismaWalletLedger,
} from './infrastructure/ledger/wallet.ledger.prisma'
import { WalletController } from './presentation/controllers/wallet.controller'

@Module({
  imports: [AuthModule],
  controllers: [WalletController],
  providers: [
    WalletFacade,
    LockFundsUseCase,
    UnlockFundsUseCase,
    ConfirmWithdrawalUseCase,
    { provide: WALLET_REPOSITORY, useClass: PrismaWalletRepository },
    { provide: WALLET_LEDGER, useClass: PrismaWalletLedger },
    { provide: WALLET_TRANSACTION_RUNNER, useClass: PrismaWalletTransactionRunner },
  ],
  exports: [WalletFacade],
})
export class WalletModule {}
