import { Inject, Injectable } from '@nestjs/common'

import {
  INowPaymentsClient,
  IPaymentRequestRepository,
  NOWPAYMENTS_CLIENT,
  PAYMENT_REQUEST_REPOSITORY,
  type PaymentRequest,
} from '../domain/payments.ports'

/**
 * Публичный API payments-модуля (MODULE_TEMPLATE Шаг 8).
 * Потребители: maintenance (estimateRub для курсов), admin (чтение платёжек,
 * approve/reject заявок).
 */
@Injectable()
export class PaymentsFacade {
  constructor(
    @Inject(NOWPAYMENTS_CLIENT) private readonly np: INowPaymentsClient,
    @Inject(PAYMENT_REQUEST_REPOSITORY) private readonly repo: IPaymentRequestRepository,
  ) {}

  /** Оценка 1 единицы currency → RUB (используется maintenance/update-rates). */
  estimateRub(
    currency: string,
  ): Promise<{ estimatedAmount: string; source: string } | null> {
    return this.np.estimate({ amount: '1', currencyFrom: currency, currencyTo: 'RUB' })
  }

  getPaymentRequest(id: string): Promise<PaymentRequest | null> {
    return this.repo.findById(id)
  }

  /** Смена статуса платёжки (admin approve/reject/batch — admin-finance). */
  updatePaymentStatus(
    id: string,
    status: PaymentRequest['status'],
    extra?: {
      completedAt?: Date | undefined
      externalStatus?: string | undefined
      errorMessage?: string | undefined
    },
  ): Promise<PaymentRequest> {
    return this.repo.updateStatus(id, status, extra)
  }

  listUserPayments(
    userId: string,
    page: number,
    perPage: number,
  ): Promise<[PaymentRequest[], number]> {
    return this.repo.listUser({ userId, type: 'deposit', page, perPage })
  }
}
