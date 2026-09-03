import { randomUUID } from 'crypto'

import { Injectable } from '@nestjs/common'
import { Decimal } from 'decimal.js'

import { type Currency } from '@casino/shared-types'
import { type KycCheckService } from '@modules/kyc/application/use-cases/kyc-check.service'
import { type WalletFacade } from '@modules/wallet/application/wallet.facade'

import { AmountTooLargeError, AmountTooSmallError } from '../../domain/errors'
import { type PaymentRequestRepository } from '../../infrastructure/repositories/payment-request.repository'

@Injectable()
export class CreateWithdrawalUseCase {
  constructor(
    private repo: PaymentRequestRepository,
    private wallet: WalletFacade,
    private kyc: KycCheckService,
  ) {}
  async execute(
    userId: string,
    input: { amount: string; currency: string; method?: string; destination: string },
  ): Promise<{ payment_request_id: string; }> {
    await this.kyc.assertCanWithdraw(userId)
    const amt = new Decimal(input.amount)
    const min = input.currency === 'RUB' ? '500' : '0.001'
    const max = input.currency === 'RUB' ? '200000' : '999999'
    if (amt.lessThan(min)) {
      throw new AmountTooSmallError(min)
    }
    if (amt.greaterThan(max)) {
      throw new AmountTooLargeError(max)
    }
    if (!amt.isFinite()) {
      throw new AmountTooSmallError('0')
    }
    // lock funds
    await this.wallet.lock({
      userId,
      currency: input.currency as Currency,
      amount: input.amount,
      idempotencyKey: `wd_lock_${randomUUID()}`,
    })
    const pr = await this.repo.create({
      userId,
      type: 'withdrawal',
      status: 'pending',
      provider: 'manual',
      method: input.method || null,
      currency: input.currency,
      amount: input.amount,
      destination: input.destination,
      idempotencyKey: `wd_${randomUUID()}`,
    })
    return { payment_request_id: pr.id }
  }
}
