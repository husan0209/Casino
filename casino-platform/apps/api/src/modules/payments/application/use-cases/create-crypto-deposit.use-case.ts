import { randomUUID } from 'crypto'

import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { errorMessage } from '@/common/utils/error-message'

import { KycFacade } from '@modules/kyc/facade/kyc.facade'

import { InvalidCurrencyError, PaymentProviderError } from '../../domain/errors'
import {
  type INowPaymentsClient,
  type IPaymentRequestRepository,
  NOWPAYMENTS_CLIENT,
  PAYMENT_REQUEST_REPOSITORY,
} from '../../domain/payments.ports'

export interface CreateCryptoDepositResult {
  payment_request_id: string
  pay_address: string
  pay_amount: string
  pay_currency: string
  expires_at: string
}

@Injectable()
export class CreateCryptoDepositUseCase {
  // eslint-disable-next-line max-params -- Nest DI: состав конструктора задаётся графом зависимостей (GAP-25)
  constructor(
    @Inject(PAYMENT_REQUEST_REPOSITORY) private readonly repo: IPaymentRequestRepository,
    @Inject(NOWPAYMENTS_CLIENT) private readonly np: INowPaymentsClient,
    // KycFacade, а не KycCheckService напрямую: межмодульный доступ только
    // через фасад (AGENTS.md правило 4, MODULE_BOUNDARIES). @Inject обязателен
    // в этой сборке — design:paramtypes не выдаётся (CONVENTIONS §1.4).
    @Inject(KycFacade) private kycCheck: KycFacade,
    @Inject(ConfigService) private config: ConfigService,
  ) {}
  async execute(
    userId: string,
    amount: string,
    currency: string,
  ): Promise<CreateCryptoDepositResult> {
    const allowed = ['USDT_TRC20', 'BTC', 'TON', 'TRX', 'LTC']
    if (!allowed.includes(currency)) {
      throw new InvalidCurrencyError()
    }
    // estimate RUB for KYC
    const est = await this.np.getEstimatePrice({
      amount,
      currencyFrom: currency,
      currencyTo: 'RUB',
    })
    const estimatedRub = est.estimatedAmount || '0'
    await this.kycCheck.assertCanDeposit(userId, estimatedRub)
    const idempotencyKey = `dep_${randomUUID()}`
    try {
      // create NP payment first to get pay_address
      const npRes = await this.np.createPayment({
        priceAmount: amount,
        priceCurrency: 'USD',
        payCurrency: currency,
        orderId: 'tmp-' + randomUUID(),
        ipnCallbackUrl: this.ipnUrl(),
      })
      const pr = await this.repo.create({
        userId,
        type: 'deposit',
        status: 'pending',
        provider: 'nowpayments',
        currency,
        amount,
        amountRub: estimatedRub,
        externalId: npRes.paymentId,
        idempotencyKey,
        expiresAt: new Date(npRes.expirationEstimateDate),
        metadata: {
          pay_address: npRes.payAddress,
          pay_amount: npRes.payAmount,
          pay_currency: npRes.payCurrency,
        },
      })
      return {
        payment_request_id: pr.id,
        pay_address: npRes.payAddress,
        pay_amount: npRes.payAmount,
        pay_currency: npRes.payCurrency,
        expires_at: npRes.expirationEstimateDate,
      }
    } catch (e) {
      throw new PaymentProviderError('NOWPayments error', { cause: errorMessage(e) })
    }
  }

  /** Адрес IPN-коллбэка NOWPayments: env → дефолт локальной разработки. */
  private ipnUrl(): string {
    return (
      this.config.get<string>('NOWPAYMENTS_WEBHOOK_URL') ||
      'http://localhost:3001/api/v1/payments/webhooks/nowpayments'
    )
  }
}
