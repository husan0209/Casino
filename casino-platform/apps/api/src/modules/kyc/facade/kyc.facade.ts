import { Inject, Injectable } from '@nestjs/common'

import { KycCheckService } from '../application/use-cases/kyc-check.service'

/**
 * Публичный API kyc-модуля (MODULE_TEMPLATE Шаг 8): другие модули ходят
 * только через фасад — payments (депозиты/выводы) и casino (запуск игр)
 * проверяют KYC-лимит через assertCan.
 */
@Injectable()
export class KycFacade {
  constructor(@Inject(KycCheckService) private readonly check: KycCheckService) {}

  assertCanDeposit(userId: string, newDepositRub: string, limitRub?: string): Promise<void> {
    return this.check.assertCanDeposit(userId, newDepositRub, limitRub)
  }

  assertCanWithdraw(userId: string): Promise<void> {
    return this.check.assertCanWithdraw(userId)
  }

  /**
   * Фиксация депозита, который превысил лимит уже ПОСЛЕ зачисления по вебхуку
   * (эскалация, а не отказ: деньги игрока на балансе). Только для вызова из
   * payments — см. KycCheckService.escalateOverDepositLimit.
   */
  escalateOverDepositLimit(args: {
    userId: string
    paymentRequestId: string
  }): Promise<void> {
    return this.check.escalateOverDepositLimit(args)
  }
}
