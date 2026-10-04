import { Inject, Injectable } from '@nestjs/common'

import {
  type INowPaymentsClient,
  type IPaymentRequestRepository,
  NOWPAYMENTS_CLIENT,
  PAYMENT_REQUEST_REPOSITORY,
  type PaymentRequest,
} from '../domain/payments.ports'

import type { PaymentStatus } from '@prisma/client'

/**
 * Публичный API payments-модуля (MODULE_TEMPLATE Шаг 8).
 * Потребители: maintenance (estimateRub для курсов), admin (заявки на вывод).
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

  /**
   * Смена статуса заявки — операция владельца решения, а не владельца таблицы.
   *
   * Раньше `admin-finance.controller.ts` инжектировал порт payments
   * (`PAYMENT_REQUEST_REPOSITORY`) и вызывал `updateStatus` сам: admin тянул
   * внутренности чужого модуля (гвард G16), а запись делал из presentation
   * (AI_DEVELOPMENT_RULES §3.3). Здесь — единственная точка, через которую
   * решение по заявке долетает до БД.
   */
  updatePaymentStatus(
    id: string,
    status: PaymentStatus,
    extra?: {
      completedAt?: Date | undefined
      errorMessage?: string | undefined
    },
  ): Promise<PaymentRequest> {
    return this.repo.updateStatus(id, status, extra)
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
