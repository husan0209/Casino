import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AuthModule } from '../../auth/auth.module'
import { WalletModule } from '../../wallet/wallet.module'
import { KycModule } from '../../kyc/kyc.module'
import { PaymentsController } from './presentation/controllers/payments.controller'
import { PaymentsWebhookController } from './presentation/controllers/payments-webhook.controller'
import { PaymentRequestRepository } from './infrastructure/repositories/payment-request.repository'
import { RukassaClient } from './infrastructure/clients/rukassa.client'
import { NOWPaymentsClient } from './infrastructure/clients/nowpayments.client'
import { CreateFiatDepositUseCase } from './application/use-cases/create-fiat-deposit.use-case'
import { CreateCryptoDepositUseCase } from './application/use-cases/create-crypto-deposit.use-case'
import { ProcessRukassaWebhookUseCase } from './application/use-cases/process-rukassa-webhook.use-case'
import { ProcessNOWPaymentsWebhookUseCase } from './application/use-cases/process-nowpayments-webhook.use-case'
import { CreateWithdrawalUseCase } from './application/use-cases/create-withdrawal.use-case'
import { CancelWithdrawalUseCase } from './application/use-cases/cancel-withdrawal.use-case'

@Module({
  imports: [ConfigModule, AuthModule, WalletModule, KycModule],
  controllers: [PaymentsController, PaymentsWebhookController],
  providers: [
    PaymentRequestRepository, RukassaClient, NOWPaymentsClient,
    CreateFiatDepositUseCase, CreateCryptoDepositUseCase,
    ProcessRukassaWebhookUseCase, ProcessNOWPaymentsWebhookUseCase,
    CreateWithdrawalUseCase, CancelWithdrawalUseCase,
  ],
})
export class PaymentsModule {}
