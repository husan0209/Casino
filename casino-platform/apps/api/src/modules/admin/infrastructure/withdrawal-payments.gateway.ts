/**
 * Реализация порта `IWithdrawalRequestStore` поверх публичного API payments.
 *
 * Почему адаптер, а не `useExisting: PAYMENT_REQUEST_REPOSITORY`: второй вариант
 * заставлял admin импортировать токен и Prisma-класс чужого модуля — это ровно
 * тот долг, который считает гвард G16 (`tech-debt check cross-module-imports`),
 * и он же давал контроллеру всю поверхность репозитория вместо двух нужных
 * методов. Здесь admin видит только фасад и переводит свой узкий контракт на
 * его операции.
 *
 * Порядок «сначала кошелёк, потом статус» живёт в use-case'ах решения по
 * заявке, поэтому у адаптера нет ни транзакций, ни бизнес-правил.
 */
import { Inject, Injectable } from '@nestjs/common'

import { PaymentsFacade } from '@modules/payments/facade/payments.facade'

import {
  type AdminWithdrawalRow,
  type IWithdrawalRequestStore,
} from '../domain/withdrawal.repository'

import type { PaymentStatus } from '@prisma/client'

@Injectable()
export class PaymentsFacadeWithdrawalGateway implements IWithdrawalRequestStore {
  constructor(@Inject(PaymentsFacade) private readonly payments: PaymentsFacade) {}

  /**
   * Заявка в том объёме, который нужен сценариям admin. Превращение Prisma-строки
   * в контракт — здесь, а не в application: наружу из адаптера не уходит ни
   * `Decimal`, ни поле, которого порт не объявлял.
   */
  async findById(id: string): Promise<AdminWithdrawalRow | null> {
    const row = await this.payments.getPaymentRequest(id)
    if (row === null) {
      return null
    }
    return {
      id: row.id,
      userId: row.userId,
      currency: row.currency,
      amount: row.amount,
      type: row.type,
      status: row.status,
    }
  }

  updateStatus(
    id: string,
    status: PaymentStatus,
    extra?: {
      completedAt?: Date | undefined
      errorMessage?: string | undefined
    },
  ): Promise<unknown> {
    return this.payments.updatePaymentStatus(id, status, extra)
  }
}
