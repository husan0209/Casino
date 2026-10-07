import { randomUUID } from 'crypto'

import { Inject, Injectable } from '@nestjs/common'
import { Decimal } from 'decimal.js'

import { GeoFacade } from '@modules/geo/facade/geo.facade'
import { KycFacade } from '@modules/kyc/facade/kyc.facade'
import { WalletFacade } from '@modules/wallet/facade/wallet.facade'

import type { DisplayCurrency } from '@casino/shared-config'
import { type Currency } from '@casino/shared-types'

import { AmountTooLargeError, AmountTooSmallError, InvalidAmountError } from '../../domain/errors'
import {
  assertWithdrawalDestination,
  MONEY_AMOUNT_PATTERN,
  withdrawalLimitsFor,
} from '../../domain/payment-currency.policy'
import {
  type IPaymentRequestRepository,
  PAYMENT_REQUEST_REPOSITORY,
} from '../../domain/payments.ports'

@Injectable()
export class CreateWithdrawalUseCase {
  constructor(
    @Inject(PAYMENT_REQUEST_REPOSITORY) private readonly repo: IPaymentRequestRepository,
    @Inject(WalletFacade) private wallet: WalletFacade,
    @Inject(KycFacade) private kyc: KycFacade,
    @Inject(GeoFacade) private geo: GeoFacade,
  ) {}
  async execute(
    userId: string,
    input: { amount: string; currency: string; method?: string; destination: string },
  ): Promise<{ payment_request_id: string }> {
    // Сумму проверяем до `new Decimal()`: без этого мусорный вход бросал сырую
    // ошибку decimal.js и клиент получал 500. Паттерн тот же, что в DTO, и он же
    // обслуживает вызывающих, минующих presentation.
    if (!MONEY_AMOUNT_PATTERN.test(input.amount)) {
      throw new InvalidAmountError()
    }
    const amt = new Decimal(input.amount)
    // Лимит берутся из `CURRENCY_LIMITS` по конкретной валюте. Прежний захардкод
    // («RUB → 500/200000, всё остальное → 0.001/999999») для USDT_TRC20 завышал
    // верхнюю границу в 50 раз (конфиг: 20000) и допускал заявки от 0.001 USDT
    // при минимуме 20, то есть лимит на вывод не действовал.
    const { min, max } = withdrawalLimitsFor(input.currency)
    assertWithdrawalDestination(input.currency, input.destination)
    if (amt.lessThan(min)) {
      throw new AmountTooSmallError(min)
    }
    if (amt.greaterThan(max)) {
      throw new AmountTooLargeError(max)
    }
    // Отдельная проверка конечности не нужна: паттерн не пропускает ни `NaN`,
    // ни экспоненциальную форму, а сверхдлинное число отсекает `greaterThan(max)`.
    //
    // Право на вывод без верификации считается в РУБЛЯХ, а не в валюте заявки
    // (порог один на все валюты — решение владельца 2026-10-07). Отсюда раздел
    // ответственности: payments переводит сумму в ₽ (курс знает geo), а kyc
    // сам добирает историю выводов и сравнивает с порогом — ровно как это уже
    // делает агрегат пополнений (kyc.prisma.ts:getTotalDepositedRub, ADR GAP-51
    // разрешает money-чтения). Вызывается ПОСЛЕ лимитов валюты и реквизитов:
    // опечатку в номере карты показываем до требования пройти KYC.
    const amountRub = await this.geo.convertToRubAtLiveRate(
      input.amount,
      input.currency as DisplayCurrency,
    )
    await this.kyc.assertCanWithdraw(userId, amountRub)
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
      // RUB-эквивалент на интенте — то же число, по которому игрок получил
      // право на вывод без верификации. Без него база порога считалась бы по
      // курсу на каждый показ и расходилась бы с отказом.
      amountRub,
      destination: input.destination,
      // GAP-55: ключ заявки тоже выводится из её id — уникальность та же (uuid),
      // но повтор запроса по той же заявке перестаёт быть невидимым для дедупликации.
      idempotencyKey: `wd_${paymentRequestId}`,
    })
    return { payment_request_id: pr.id }
  }
}
