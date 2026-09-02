import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomUUID } from 'crypto'

import { errorMessage } from '@/common/utils/error-message'
import { KycCheckService } from '@modules/kyc/application/use-cases/kyc-check.service'

import { PaymentProviderError } from '../../domain/errors'
import { NOWPaymentsClient } from '../../infrastructure/clients/nowpayments.client'
import { PaymentRequestRepository } from '../../infrastructure/repositories/payment-request.repository'




@Injectable()
export class CreateCryptoDepositUseCase {
  // eslint-disable-next-line max-params -- Nest DI: состав конструктора задаётся графом зависимостей (GAP-25)
  constructor(
    private repo: PaymentRequestRepository,
    private np: NOWPaymentsClient,
    private kycCheck: KycCheckService,
    private config: ConfigService,
  ) {}
  async execute(userId: string, amount: string, currency: string) {
    const allowed = ['USDT_TRC20', 'BTC', 'TON', 'TRX', 'LTC']
    if (!allowed.includes(currency)) {
      throw new Error('INVALID_CURRENCY')
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
    const ipn =
      this.config.get('NOWPAYMENTS_WEBHOOK_URL') ||
      'http://localhost:3001/api/v1/payments/webhooks/nowpayments'
    try {
      // create NP payment first to get pay_address
      const npRes = await this.np.createPayment({
        priceAmount: amount,
        priceCurrency: 'USD',
        payCurrency: currency,
        orderId: 'tmp-' + randomUUID(),
        ipnCallbackUrl: ipn,
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
}
