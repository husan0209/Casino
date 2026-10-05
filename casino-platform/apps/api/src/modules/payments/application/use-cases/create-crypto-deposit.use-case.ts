import { randomUUID } from 'crypto'

import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { errorMessage } from '@/common/utils/error-message'

import { KycFacade } from '@modules/kyc/facade/kyc.facade'

import { AppError } from '@casino/shared-utils'

import { PaymentProviderError } from '../../domain/errors'
import { assertReleaseCryptoCurrency } from '../../domain/payment-currency.policy'
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
    // TZ-02: допустимые валюты задаёт релизный набор (domain/payment-currency.policy,
    // источник — @casino/shared-config), а не локальный список. Раньше здесь лежал
    // свой whitelist с TON/TRX/LTC, и заявка в исключённой из релиза валюте
    // доходила до провайдера с pay_currency='ton'|'trx'|'ltc'. Отклонение — до
    // estimate и до createPayment: к NOWPayments не уходит ни один запрос.
    const payCurrency = assertReleaseCryptoCurrency(currency)
    // estimate RUB for KYC
    const est = await this.np.getEstimatePrice({
      amount,
      currencyFrom: payCurrency,
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
        payCurrency,
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
      // AppError (в т.ч. back-stop-проверка релизной валюты в клиенте) наружу
      // без изменений: INVALID_CURRENCY остаётся 422 со своим кодом, а не
      // превращается в PAYMENT_PROVIDER_ERROR/502. Сбои провайдера и транспорта
      // заворачиваются, как и раньше.
      if (e instanceof AppError) {
        throw e
      }
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
