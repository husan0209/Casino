import { Inject, Injectable } from '@nestjs/common'

import {
  IPaymentRequestRepository,
  PAYMENT_REQUEST_REPOSITORY,
  type PaymentRequest,
} from '../../domain/payments.ports'

/** Список выводов пользователя (В3: контроллер без репозитория). */
@Injectable()
export class ListWithdrawalsUseCase {
  constructor(@Inject(PAYMENT_REQUEST_REPOSITORY) private readonly repo: IPaymentRequestRepository) {}

  async execute(
    userId: string,
    page: number,
    perPage: number,
  ): Promise<{ items: PaymentRequest[]; meta: { page: number; total: number } }> {
    const [items, total] = await this.repo.listUser({
      userId,
      type: 'withdrawal',
      page,
      perPage,
    })
    return { items, meta: { page, total } }
  }
}
