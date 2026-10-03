import { randomUUID } from 'crypto'

import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { errorMessage } from '@/common/utils/error-message'

import { GeoFacade } from '@modules/geo/facade/geo.facade'
import { KycFacade } from '@modules/kyc/facade/kyc.facade'
import { UsersFacade } from '@modules/users/facade/users.facade'

import type { DisplayCurrency } from '@casino/shared-config'
import { money } from '@casino/shared-utils'

import { AmountTooLargeError, AmountTooSmallError, PaymentProviderError } from '../../domain/errors'
import {
  type IRukassaClient,
  type IPaymentRequestRepository,
  PAYMENT_REQUEST_REPOSITORY,
  RUKASSA_CLIENT,
} from '../../domain/payments.ports'

export interface CreateFiatDepositInput {
  amount: string
  currency: string
  method: string
}

export interface CreateFiatDepositResult {
  payment_request_id: string
  payment_url: string
  currency: string
  method: string
}

@Injectable()
export class CreateFiatDepositUseCase {
  constructor(
    @Inject(PAYMENT_REQUEST_REPOSITORY) private readonly repo: IPaymentRequestRepository,
    @Inject(RUKASSA_CLIENT) private readonly rukassa: IRukassaClient,
    // KycFacade, а не KycCheckService напрямую: межмодульный доступ только
    // через фасад (AGENTS.md правило 4). @Inject обязателен — design:paramtypes
    // в этой сборке не выдаётся (CONVENTIONS §1.4).
    @Inject(KycFacade) private kycCheck: KycFacade,
    @Inject(ConfigService) private config: ConfigService,
    @Inject(GeoFacade) private geo: GeoFacade,
    @Inject(UsersFacade) private users: UsersFacade,
  ) {}

  async execute(userId: string, input: CreateFiatDepositInput): Promise<CreateFiatDepositResult> {
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

    try {
      const res = await this.rukassa.createPayment({
        amount,
        orderId: pr.id,
        method,
        webhookUrl: this.webhookUrl(),
        successUrl: this.successUrl(),
        failUrl: this.failUrl(),
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

  /** Адреса возврата/коллбэка Rukassa: env → дефолт локальной разработки. */
  private webhookUrl(): string {
    return (
      this.config.get<string>('RUKASSA_WEBHOOK_URL') ||
      'http://localhost:3001/api/v1/payments/webhooks/rukassa'
    )
  }

  private successUrl(): string {
    return (
      this.config.get<string>('RUKASSA_SUCCESS_URL') || 'http://localhost:3000/?deposit=success'
    )
  }

  private failUrl(): string {
    return this.config.get<string>('RUKASSA_FAIL_URL') || 'http://localhost:3000/?deposit=failed'
  }
}
