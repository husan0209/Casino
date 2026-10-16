import { randomUUID } from 'crypto'

import { Inject, Injectable } from '@nestjs/common'

import { errorMessage } from '@/common/utils/error-message'

import { GeoFacade } from '@modules/geo/facade/geo.facade'
import { UsersFacade } from '@modules/users/facade/users.facade'

import type { DisplayCurrency } from '@casino/shared-config'
import { money } from '@casino/shared-utils'

import {
  AmountTooSmallError,
  FiatDepositAttemptLimitError,
  providerRefusalError,
} from '../../domain/errors'
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

/**
 * Сколько неоплаченных заявок на пополнение игрок имеет право создать за сутки.
 *
 * Порог заморозки у RuKassa измерен на стенде 16.10: три неоплаченных счёта
 * проходят, четвёртый — `403 client is frozen`. Берём два, чтобы между нашим
 * «стоп» и их блокировкой оставался один шаг запаса: разморозить клиента мы
 * не можем, API-метода у них нет.
 */
export const FIAT_UNPAID_ATTEMPTS_PER_DAY = 2

/**
 * Начало текущих «суток» по МСК. RuKassa обнуляет счётчик неоплаченных заявок
 * в 00:00 (сказал их саппорт), а рынок у нас RU. MSK = UTC+3 без перевода
 * часов с 2014 года, поэтому смещение константой, а не tz-бблиотекой.
 */
const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
export function startOfMoscowDay(now = new Date()): Date {
  const local = now.getTime() + MOSCOW_OFFSET_MS
  return new Date(Math.floor(local / DAY_MS) * DAY_MS - MOSCOW_OFFSET_MS)
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

    // Самолимит ДО обращения к провайдеру: заявка, которую игрок не оплатил,
    // считается у RuKassa и приближает заморозку его клиента (наш `user_code` =
    // id игрока, навсегда). Отказ здесь — наш 422, а не их 502.
    const unfinished = await this.repo.countUnfinishedDeposits({
      userId,
      provider: 'rukassa',
      since: startOfMoscowDay(),
    })
    if (unfinished >= FIAT_UNPAID_ATTEMPTS_PER_DAY) {
      throw new FiatDepositAttemptLimitError()
    }

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
