import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

import { AuthModule } from '../auth/auth.module'
import { GeoModule } from '../geo/geo.module'
import { KycModule } from '../kyc/kyc.module'
import { UsersModule } from '../users/users.module'
import { WalletModule } from '../wallet/wallet.module'
import { CancelWithdrawalUseCase } from './application/use-cases/cancel-withdrawal.use-case'
import { CreateCryptoDepositUseCase } from './application/use-cases/create-crypto-deposit.use-case'
import { CreateFiatDepositUseCase } from './application/use-cases/create-fiat-deposit.use-case'
import { CreateWithdrawalUseCase } from './application/use-cases/create-withdrawal.use-case'
import { ProcessNOWPaymentsWebhookUseCase } from './application/use-cases/process-nowpayments-webhook.use-case'
import { ProcessRukassaWebhookUseCase } from './application/use-cases/process-rukassa-webhook.use-case'
import {
  NOWPAYMENTS_CLIENT,
  PAYMENT_REQUEST_REPOSITORY,
  RUKASSA_CLIENT,
} from './domain/payments.ports'
import { NOWPaymentsClient } from './infrastructure/clients/nowpayments.client'
import { RukassaClient } from './infrastructure/clients/rukassa.client'
import { PaymentRequestRepository } from './infrastructure/repositories/payment-request.repository'
import { PaymentsWebhookController } from './presentation/controllers/payments-webhook.controller'
import { PaymentsController } from './presentation/controllers/payments.controller'

@Module({
  imports: [ConfigModule, AuthModule, WalletModule, KycModule, GeoModule, UsersModule],
  controllers: [PaymentsController, PaymentsWebhookController],
  providers: [
    // Класс-токен остаётся: presentation-контроллер payments.controller.ts пока
    // внедряет репозиторий напрямую (вне рамок задачи В5 — только application).
    PaymentRequestRepository,
    // В5: application-слой получает infrastructure только через порты (DI-токены).
    // useExisting — тот же экземпляр, что и у класс-токена (образец: geo.module.ts).
    { provide: PAYMENT_REQUEST_REPOSITORY, useExisting: PaymentRequestRepository },
    { provide: RUKASSA_CLIENT, useClass: RukassaClient },
    { provide: NOWPAYMENTS_CLIENT, useClass: NOWPaymentsClient },
    CreateFiatDepositUseCase,
    CreateCryptoDepositUseCase,
    ProcessRukassaWebhookUseCase,
    ProcessNOWPaymentsWebhookUseCase,
    CreateWithdrawalUseCase,
    CancelWithdrawalUseCase,
  ],
})
export class PaymentsModule {}
