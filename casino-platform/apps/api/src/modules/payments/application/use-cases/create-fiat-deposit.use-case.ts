import { randomUUID } from 'crypto'

import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { errorMessage } from '@/common/utils/error-message'
import { money } from '@casino/shared-utils'
import { GeoFacade } from '@modules/geo/facade/geo.facade'
import { KycCheckService } from '@modules/kyc/application/use-cases/kyc-check.service'
import { UsersFacade } from '@modules/users/facade/users.facade'

import { AmountTooLargeError, AmountTooSmallError, PaymentProviderError } from '../../domain/errors'
import { RukassaClient } from '../../infrastructure/clients/rukassa.client'
import { PaymentRequestRepository } from '../../infrastructure/repositories/payment-request.repository'

import type { DisplayCurrency } from '@casino/shared-config'

export interface CreateFiatDepositInput {
  amount: string
  currency: string
  method: string
}

@Injectable()
export class CreateFiatDepositUseCase {
  // eslint-disable-next-line max-params -- Nest DI: состав конструктора задаётся графом зависимостей (GAP-25)
  constructor(
    private repo: PaymentRequestRepository,
    private rukassa: RukassaClient,
    private kycCheck: KycCheckService,
    private config: ConfigService,
    private geo: GeoFacade,
    private users: UsersFacade,
  ) {}

  async execute(userId: string, input: CreateFiatDepositInput) {
    const { amount, currency, method } = input

    const userContext = await this.users.getGeoContext(userId)
    const legalCountry = this.geo.resolveLegalCountry(userContext?.country)
    this.geo.validateFiatDepositMethod(legalCountry, currency, method)

    const limits = this.geo.getLimits(currency as DisplayCurrency)
    if (!money.isGreaterOrEqual(amount, limits.depositMin)) {
      throw new AmountTooSmallError(limits.depositMin)
    }
    if (money.isGreaterThan(amount, limits.depositMax)) {
      throw new AmountTooLargeError(limits.depositMax)
    }

    const amountRub = this.geo.toRubEquivalent(amount, currency as DisplayCurrency)
    await this.kycCheck.assertCanDeposit(userId, amountRub)

    const idempotencyKey = `dep_${randomUUID()}`
    const pr = await this.repo.create({
      userId,
      type: 'deposit',
      status: 'pending',
      provider: 'rukassa',
      method,
      currency,
      amount,
      amountRub,
      idempotencyKey,
      expiresAt: new Date(Date.now() + 2 * 3600 * 1000),
    })

    const webhookUrl =
      this.config.get('RUKASSA_WEBHOOK_URL') ||
      'http://localhost:3001/api/v1/payments/webhooks/rukassa'
    const successUrl =
      this.config.get('RUKASSA_SUCCESS_URL') || 'http://localhost:3000/?deposit=success'
    const failUrl = this.config.get('RUKASSA_FAIL_URL') || 'http://localhost:3000/?deposit=failed'

    try {
      const res = await this.rukassa.createPayment({
        amount,
        orderId: pr.id,
        method,
        webhookUrl,
        successUrl,
        failUrl,
      })
      await this.repo.updateStatus(pr.id, 'pending', {
        externalId: res.paymentId,
        paymentUrl: res.paymentUrl,
      })
      return { payment_request_id: pr.id, payment_url: res.paymentUrl, currency, method }
    } catch (e) {
      await this.repo.updateStatus(pr.id, 'failed', { errorMessage: errorMessage(e) })
      throw new PaymentProviderError('Rukassa error', { cause: errorMessage(e) })
    }
  }
}
