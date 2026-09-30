/**
 * Адаптер affiliate-модуля, реализующий порт `RESPONSIBLE_GAMING_HOOK`
 * модуля users (ТЗ ч.8 §14.1, решение C).
 *
 * users не знает про affiliate: он видит только интерфейс
 * ResponsibleGamingHook и получает его через DI. Здесь — конкретная реализация,
 * которая отменяет начисления игрока и возвращает деньги партнёру.
 */
import { Inject, Injectable, Logger } from '@nestjs/common'

import { ClawbackPlayerCommissionsUseCase } from '../application/use-cases/clawback-player-commissions.use-case'

import type { ResponsibleGamingHook } from '../../users/domain/responsible-gaming-hook'

@Injectable()
export class AffiliateResponsibleGamingHook implements ResponsibleGamingHook {
  private readonly logger = new Logger(AffiliateResponsibleGamingHook.name)

  constructor(
    @Inject(ClawbackPlayerCommissionsUseCase)
    private readonly clawback: ClawbackPlayerCommissionsUseCase,
  ) {}

  /**
   * Clawback начислений самоисключённого игрока.
   *
   * Результат логируется, а не выбрасывается: невозвратные суммы (партнёр уже
   * вывел заработок) — это операционная задолженность, которую админ обязан
   * увидеть. Сам факт провала НЕ пробрасывается вверх — см. комментарий в
   * SelfExclusionUseCase.notifyResponsibleGamingHook.
   */
  async onSelfExclusion(playerId: string): Promise<void> {
    const result = await this.clawback.execute({ playerId })
    if (!result.checked) {
      return
    }
    this.logger.warn(
      `Self-exclusion clawback: player=${playerId} cancelled=${result.cancelled} reversed=${result.reversedAmount} unrecoverable=${result.insufficientFunds.length} errors=${result.errors.length}`,
    )
    for (const item of result.insufficientFunds) {
      this.logger.error(
        `Unrecoverable clawback debt: commission=${item.commissionId} amount=${item.amount} ${item.currency}`,
      )
    }
    for (const message of result.errors) {
      this.logger.error(`Clawback error: ${message}`)
    }
  }
}

export { ClawbackPlayerCommissionsUseCase }
