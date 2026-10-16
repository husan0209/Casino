import { randomUUID } from 'crypto'

import { Inject, Injectable } from '@nestjs/common'

import { errorMessage } from '@/common/utils/error-message'

import { GeoFacade } from '@modules/geo/facade/geo.facade'
import { UsersFacade } from '@modules/users/facade/users.facade'

import type { DisplayCurrency } from '@casino/shared-config'
import { money } from '@casino/shared-utils'

import { AmountTooSmallError, providerRefusalError } from '../../domain/errors'
import {
  type IRukassaClient,
  type IPaymentRequestRepository,
  PAYMENT_REQUEST_REPOSITORY,
  RUKASSA_CLIENT,
} from '../../domain/payments.ports'

export interface CreateFiatDepositInput {
  amount: string
  currency: string
  method: string
}

export interface CreateFiatDepositResult {
  payment_request_id: string
  payment_url: string
  currency: string
  method: string
}

/**
 * `order_id` у Rukassa — число (их пример: time() . mt_rand()), а наш id заявки —
 * UUID. Счётчик внутри миллисекунды снимает коллизию двух депозитов одного момента;
 * на поиски платёжки это не влияет — вебхук резолвится по `data` и external_id.
 */
let orderCounter = 0
export function rukassaOrderId(now = Date.now()): string {
  orderCounter = (orderCounter + 1) % 1000
  return String(now * 1000 + orderCounter)
}

@Injectable()
export class CreateFiatDepositUseCase {
  constructor(
    @Inject(PAYMENT_REQUEST_REPOSITORY) private readonly repo: IPaymentRequestRepository,
    @Inject(RUKASSA_CLIENT) private readonly rukassa: IRukassaClient,
    @Inject(GeoFacade) private geo: GeoFacade,
    @Inject(UsersFacade) private users: UsersFacade,
  ) {}

  async execute(userId: string, input: CreateFiatDepositInput): Promise<CreateFiatDepositResult> {
    const { amount, currency, method } = input

    const userContext = await this.users.getGeoContext(userId)
    const legalCountry = this.geo.resolveLegalCountry(userContext?.country)
    this.geo.validateFiatDepositMethod(legalCountry, currency, method)

    const limits = this.geo.getLimits(currency as DisplayCurrency)
    if (!money.isGreaterOrEqual(amount, limits.depositMin)) {
      throw new AmountTooSmallError(limits.depositMin)
    }
    // Верхней границы у пополнения нет (решение владельца 2026-10-07): 1 000 ₽
    // или 1 000 000 ₽ — сумма игрока, и оба его дело. Максимум платёжного метода
    // приходит отказом провайдера; наш предельный контроль стоит на выводе.

    const amountRub = this.geo.toRubEquivalent(amount, currency as DisplayCurrency)

    const idempotencyKey = `dep_${randomUUID()}`
    const pr = await this.repo.create({
      userId,
      type: 'deposit',
      status: 'pending',
      provider: 'rukassa',
      method,
      currency,
      amount,
      amountRub,
      idempotencyKey,
      expiresAt: new Date(Date.now() + 2 * 3600 * 1000),
    })

    try {
      const res = await this.rukassa.createPayment({
        amount,
        orderId: rukassaOrderId(),
        currency,
        method,
        // Их «клиент» = `user_code`. Общий на всех id магазина RuKassa замораживает
        // (проверено живьём: 4104 → «client is frozen», любой свежий id → 200),
        // поэтому код игрока.
        userCode: userId,
        // Сквозной JSON: Rukassa возвращает его в уведомлении без изменений,
        // поэтому платёжку находим по нашему id, а не по их номерам.
        data: JSON.stringify({ payment_request_id: pr.id }),
      })
      await this.repo.updateStatus(pr.id, 'pending', {
        externalId: res.paymentId,
        paymentUrl: res.paymentUrl,
      })
      return { payment_request_id: pr.id, payment_url: res.paymentUrl, currency, method }
    } catch (e) {
      // Полный текст провайдера — только в БД (его читает админ) и в лог. В
      // HTTP-ответ он уходить не должен: context AppError фильтр кладёт в details.
      // Но и молчать отказ не вправе: код ниже говорит игроку, что делать.
      const reason = errorMessage(e)
      await this.repo.updateStatus(pr.id, 'failed', { errorMessage: reason })
      throw providerRefusalError(reason)
    }
  }
}
