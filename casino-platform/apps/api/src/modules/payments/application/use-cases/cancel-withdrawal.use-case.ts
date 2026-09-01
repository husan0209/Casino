import { randomUUID } from 'crypto'

import { Injectable, ForbiddenException } from '@nestjs/common'

import { WalletFacade } from '@modules/wallet/application/wallet.facade'

import type { Currency } from '@casino/shared-types'

import { PaymentRequestRepository } from '../../infrastructure/repositories/payment-request.repository'

@Injectable()
export class CancelWithdrawalUseCase {
  constructor(
    private repo: PaymentRequestRepository,
    private wallet: WalletFacade,
  ) {}
  async execute(userId: string, id: string) {
    const pr = await this.repo.findById(id)
    if (!pr || pr.userId !== userId) {
      throw new ForbiddenException()
    }
    if (pr.status !== 'pending') {
      throw new ForbiddenException('Cannot cancel')
    }
    await this.wallet.unlock({
      userId,
      currency: pr.currency as Currency,
      amount: pr.amount.toString(),
      idempotencyKey: `wd_unlock_${randomUUID()}`,
    })
    await this.repo.updateStatus(id, 'cancelled')
    return { ok: true }
  }
}
