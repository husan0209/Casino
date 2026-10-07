import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { GeoFacade } from '@modules/geo/facade/geo.facade'

import type { DisplayCurrency } from '@casino/shared-config'
import { money } from '@casino/shared-utils'

import { type IKycRepository, KYC_REPOSITORY } from '../../domain/repositories/kyc.repository'
import { kycWithdrawLimitRub } from '../kyc-limits'
import { withdrawnRubTotal } from '../withdrawn-total'

/**
 * Что видит игрок про верификацию (GAP-36).
 *
 * Поля про пополнение здесь были и убраны 2026-10-07 вместе с отказом на
 * депозите: `deposit_limit_rub` / `total_deposited_rub` больше ни в чём не
 * отказывают, а показанная игроку цифра «остаток лимита пополнения» — это
 * обещание правила, которого нет. Порог `KYC_DEPOSIT_LIMIT_RUB` остался только
 * как риск-лог при зачислении (`KycCheckService.escalateOverDepositLimit`), и
 * наружу он не выходит.
 */
@Injectable()
export class GetKycStatusUseCase {
  constructor(
    @Inject(KYC_REPOSITORY) private repo: IKycRepository,
    @Inject(GeoFacade) private geo: GeoFacade,
    @Inject(ConfigService) private config: ConfigService,
  ) {}

  async execute(
    userId: string,
    currency = 'RUB',
  ): Promise<{
    withdraw_limit_rub: string
    withdrawn_rub: string
    withdraw_remaining_rub: string
    withdraw_remaining: string
    withdraw_currency: DisplayCurrency
    status?: string
    submittedAt?: Date | null
    rejectionReason?: string | null
    documents?: string[]
  }> {
    const status = await this.repo.getStatus(userId)
    // Порог и база — общие с KycCheckService.assertCanWithdraw (kyc-limits.ts и
    // withdrawn-total.ts): цифра на странице обязана быть тем же числом, по
    // которому сервер отказывает, иначе страница верификации врёт намеренно.
    const limitRub = kycWithdrawLimitRub(this.config)
    const withdrawnRub = withdrawnRubTotal(
      await this.repo.listCountedWithdrawals(userId),
      (amount, cur) => this.geo.toRubEquivalent(amount, cur),
    )
    // Для approved поле не используется: порога у одобренного игрока нет, и
    // «остаток 0» означал бы, что ему нельзя выводить.
    const remainingRub = money.isGreaterThan(withdrawnRub, limitRub)
      ? '0'
      : money.subtract(limitRub, withdrawnRub)

    const displayCurrency = (currency || 'RUB') as DisplayCurrency
    const remaining = await this.geo.convertRubToDisplay(remainingRub, displayCurrency)

    return {
      ...status,
      withdraw_limit_rub: limitRub,
      withdrawn_rub: withdrawnRub,
      withdraw_remaining_rub: remainingRub,
      withdraw_remaining: remaining,
      withdraw_currency: displayCurrency,
    }
  }
}
