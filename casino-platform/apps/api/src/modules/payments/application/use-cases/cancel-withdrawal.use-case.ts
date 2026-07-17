import { Injectable, ForbiddenException } from '@nestjs/common'
import { PaymentRequestRepository } from '../../infrastructure/repositories/payment-request.repository'
import { WalletFacade } from '../../../wallet/application/wallet.facade'
import { randomUUID } from 'crypto'
@Injectable()
export class CancelWithdrawalUseCase {
  constructor(private repo: PaymentRequestRepository, private wallet: WalletFacade) {}
  async execute(userId: string, id: string) {
    const pr = await this.repo.findById(id)
    if (!pr || pr.userId !== userId) throw new ForbiddenException()
    if (pr.status !== 'pending') throw new ForbiddenException('Cannot cancel')
    await this.wallet.unlock(userId, pr.currency as any, pr.amount.toString(), `wd_unlock_${randomUUID()}`)
    await this.repo.updateStatus(id, 'cancelled')
    return { ok: true }
  }
}
