import { Inject, Injectable } from '@nestjs/common'

import { PaymentRequestNotFoundError } from '../../domain/errors'
import {
  type IPaymentRequestRepository,
  PAYMENT_REQUEST_REPOSITORY,
  type PaymentRequest,
} from '../../domain/payments.ports'

/** Статус депозита для владельца заявки (В3: контроллер без репозитория). */
@Injectable()
export class GetDepositStatusUseCase {
  constructor(
    @Inject(PAYMENT_REQUEST_REPOSITORY) private readonly repo: IPaymentRequestRepository,
  ) {}

  async execute(
    userId: string,
    id: string,
  ): Promise<{
    id: string
    status: PaymentRequest['status']
    currency: string
    amount: string
    payment_url: string | null
    completed_at: Date | null
  }> {
    const pr = await this.repo.findById(id)
    if (pr?.userId !== userId) {
      throw new PaymentRequestNotFoundError()
    }
    return {
      id: pr.id,
      status: pr.status,
      currency: pr.currency,
      amount: pr.amount.toString(),
      payment_url: pr.paymentUrl,
      completed_at: pr.completedAt,
    }
  }
}
