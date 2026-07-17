import { Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { PaymentRequestRepository } from '../../infrastructure/repositories/payment-request.repository'
import { RukassaClient } from '../../infrastructure/clients/rukassa.client'
import { KycCheckService } from '../../../kyc/application/use-cases/kyc-check.service'
import { AmountTooSmallError, AmountTooLargeError, PaymentProviderError } from '../../domain/errors'
import { ConfigService } from '@nestjs/config'

@Injectable()
export class CreateFiatDepositUseCase {
  constructor(
    private repo: PaymentRequestRepository,
    private rukassa: RukassaClient,
    private kycCheck: KycCheckService,
    private config: ConfigService,
  ) {}
  async execute(userId: string, amount: string, method = 'card') {
    const amt = parseFloat(amount)
    if (amt < 100) throw new AmountTooSmallError('100')
    if (amt > 500000) throw new AmountTooLargeError('500000')
    await this.kycCheck.assertCanDeposit(userId, amt)
    const idempotencyKey = `dep_${randomUUID()}`
    const pr = await this.repo.create({
      userId, type: 'deposit', status: 'pending', provider: 'rukassa',
      method, currency: 'RUB', amount, amountRub: amt,
      idempotencyKey,
      expiresAt: new Date(Date.now() + 2*3600*1000),
    })
    const webhookUrl = this.config.get('RUKASSA_WEBHOOK_URL') || 'http://localhost:3001/api/v1/payments/webhooks/rukassa'
    const successUrl = this.config.get('RUKASSA_SUCCESS_URL') || 'http://localhost:3000/wallet?deposit=success'
    const failUrl = this.config.get('RUKASSA_FAIL_URL') || 'http://localhost:3000/wallet?deposit=failed'
    try {
      const res = await this.rukassa.createPayment({
        amount, orderId: pr.id, method, webhookUrl, successUrl, failUrl
      })
      await this.repo.updateStatus(pr.id, 'pending', { externalId: res.paymentId, paymentUrl: res.paymentUrl })
      return { payment_request_id: pr.id, payment_url: res.paymentUrl }
    } catch (e:any) {
      await this.repo.updateStatus(pr.id, 'failed', { errorMessage: e.message })
      throw new PaymentProviderError('Rukassa error', { cause: e.message })
    }
  }
}
