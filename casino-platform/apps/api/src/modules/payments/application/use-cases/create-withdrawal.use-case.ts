import { randomUUID } from 'crypto'

import { Injectable } from '@nestjs/common'
import { Decimal } from 'decimal.js'

import { KycCheckService } from '@modules/kyc/application/use-cases/kyc-check.service'
import { WalletFacade } from '@modules/wallet/application/wallet.facade'

import { type Currency } from '@casino/shared-types'

import { AmountTooLargeError, AmountTooSmallError } from '../../domain/errors'
import { PaymentRequestRepository } from '../../infrastructure/repositories/payment-request.repository'

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
    // GAP-55 (§11 «статус»): id заявки генерируется ДО блокировки, чтобы
    // проводка WITHDRAWAL_LOCK несла ссылку на payment_request — иначе строку
    // истории нечем присоединить к заявке и показать её статус. Порядок
    // «сначала lock, потом заявка» сохранён: при отказе блокировки (нехватка
    // средств) заявка не создаётся, как и раньше.
    const paymentRequestId = randomUUID()
    // lock funds
    await this.wallet.lock({
      userId,
      currency: input.currency as Currency,
      amount: input.amount,
      idempotencyKey: `wd_lock_${paymentRequestId}`,
      metadata: { payment_request_id: paymentRequestId },
    })
    const pr = await this.repo.create({
      id: paymentRequestId,
      userId,
      type: 'withdrawal',
      status: 'pending',
      provider: 'manual',
      method: input.method || null,
      currency: input.currency,
      amount: input.amount,
      destination: input.destination,
      // GAP-55: ключ заявки тоже выводится из её id — уникальность та же (uuid),
      // но повтор запроса по той же заявке перестаёт быть невидимым для дедупликации.
      idempotencyKey: `wd_${paymentRequestId}`,
    })
    return { payment_request_id: pr.id }
  }
}
