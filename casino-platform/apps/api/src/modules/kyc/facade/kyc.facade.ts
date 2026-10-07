import { Inject, Injectable } from '@nestjs/common'

import { KycCheckService } from '../application/use-cases/kyc-check.service'

/**
 * Публичный API kyc-модуля (MODULE_TEMPLATE Шаг 8): другие модули ходят
 * только через фасад — payments (выводы) и casino (запуск игр) проверяют KYC
 * через assertCan*.
 *
 * Депозитов здесь больше нет: верификация требуется на выводе, а не на
 * пополнении (решение владельца 2026-10-07). Порог `KYC_DEPOSIT_LIMIT_RUB`
 * остался как внутренний риск-признак — `escalateOverDepositLimit` пишет
 * структурированный лог, но ни в чём не отказывает.
 */
@Injectable()
export class KycFacade {
  constructor(@Inject(KycCheckService) private readonly check: KycCheckService) {}

  /**
   * можно ли игроку выводить `amountRub` — ₽-эквивалент заявки считает
   * вызывающий (payments владеет курсом и суммой). Одобренный — всегда можно;
   * неверифицированному — только пока сумма с уже выведенным не превышает
   * `KYC_WITHDRAW_LIMIT_RUB`. Отказ — `KycRequiredError` (422).
   */
  assertCanWithdraw(userId: string, amountRub: string): Promise<void> {
    return this.check.assertCanWithdraw(userId, amountRub)
  }

  /**
   * Фиксация депозита, который превысил лимит уже ПОСЛЕ зачисления по вебхуку
   * (эскалация, а не отказ: деньги игрока на балансе). Только для вызова из
   * payments — см. KycCheckService.escalateOverDepositLimit.
   */
  escalateOverDepositLimit(args: { userId: string; paymentRequestId: string }): Promise<void> {
    return this.check.escalateOverDepositLimit(args)
  }
}
