import { Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { PaymentRequestRepository } from '../../infrastructure/repositories/payment-request.repository'
import { WalletFacade } from '../../../wallet/application/wallet.facade'
import { KycCheckService } from '../../../kyc/application/use-cases/kyc-check.service'
import { AmountTooSmallError, AmountTooLargeError } from '../../domain/errors'
@Injectable()
export class CreateWithdrawalUseCase {
  constructor(private repo: PaymentRequestRepository, private wallet: WalletFacade, private kyc: KycCheckService) {}
  async execute(userId: string, input: { amount: string; currency: string; method?: string; destination: any }) {
    await this.kyc.assertCanWithdraw(userId)
    const amt = parseFloat(input.amount)
    const min = input.currency === 'RUB' ? 500 : 0.001
    const max = input.currency === 'RUB' ? 200000 : 999999
    if (amt < min) throw new AmountTooSmallError(String(min))
    if (amt > max) throw new AmountTooLargeError(String(max))
    // lock funds
    await this.wallet.lock(userId, input.currency as any, input.amount, `wd_lock_${randomUUID()}`)
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
