import { Inject, Injectable } from '@nestjs/common'

import {
  type INowPaymentsClient,
  type IPaymentRequestRepository,
  NOWPAYMENTS_CLIENT,
  PAYMENT_REQUEST_REPOSITORY,
  type PaymentRequest,
} from '../domain/payments.ports'

/**
 * Публичный API payments-модуля (MODULE_TEMPLATE Шаг 8).
 * Потребители: maintenance (estimateRub для курсов), admin (чтение платёжек).
 */
@Injectable()
export class PaymentsFacade {
  constructor(
    @Inject(NOWPAYMENTS_CLIENT) private readonly np: INowPaymentsClient,
    @Inject(PAYMENT_REQUEST_REPOSITORY) private readonly repo: IPaymentRequestRepository,
  ) {}

  /** Оценка 1 единицы currency → RUB (используется maintenance/update-rates). */
  estimateRub(currency: string): Promise<{ estimatedAmount: string; source: string } | null> {
    return this.np.estimate({ amount: '1', currencyFrom: currency, currencyTo: 'RUB' })
  }

  getPaymentRequest(id: string): Promise<PaymentRequest | null> {
    return this.repo.findById(id)
  }

  listUserPayments(
    userId: string,
    page: number,
    perPage: number,
  ): Promise<{ items: PaymentRequest[]; total: number }> {
    return this.repo
      .listUser({ userId, type: 'deposit', page, perPage })
      .then(([items, total]) => ({ items, total }))
  }
}
