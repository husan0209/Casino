import { Inject, Injectable } from '@nestjs/common'

import { WalletFacade } from '@modules/wallet/application/wallet.facade'

import type { Currency } from '@casino/shared-types'

import { WithdrawalCancelForbiddenError } from '../../domain/errors'
import { IPaymentRequestRepository, PAYMENT_REQUEST_REPOSITORY } from '../../domain/payments.ports'

@Injectable()
export class CancelWithdrawalUseCase {
  constructor(
    @Inject(PAYMENT_REQUEST_REPOSITORY) private readonly repo: IPaymentRequestRepository,
    private wallet: WalletFacade,
  ) {}
  async execute(userId: string, id: string): Promise<{ ok: boolean }> {
    const pr = await this.repo.findById(id)
    if (!pr || pr.userId !== userId) {
      throw new WithdrawalCancelForbiddenError()
    }
    if (pr.status !== 'pending') {
      throw new WithdrawalCancelForbiddenError('Cannot cancel')
    }
    // GAP-55 (§11): ключ детерминированный от id заявки + ссылка в метаданных —
    // повтор отмены той же заявки дедуплицируется ledger'ом, а строка истории
    // присоединяется к заявке.
    await this.wallet.unlock({
      userId,
      currency: pr.currency as Currency,
      amount: pr.amount.toString(),
      idempotencyKey: `wd_unlock_${pr.id}`,
      metadata: { payment_request_id: pr.id },
    })
    await this.repo.updateStatus(id, 'cancelled')
    return { ok: true }
  }
}
