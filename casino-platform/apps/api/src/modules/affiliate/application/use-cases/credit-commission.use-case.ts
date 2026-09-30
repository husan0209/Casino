/**
 * Начисление комиссии на кошелёк партнёра (UC-AFF-10, ТЗ ч.8 §8.5).
 *
 * ИДEMPОТЕНТНОСТЬ. idempotencyKey = `aff_{commissionId}`. Повторный вызов
 * (ретрай cron-а, рестарт воркера) не зачислит деньги дважды: WalletFacade
 * вернёт duplicate.
 *
 * ПОРЯДОК ОПЕРАЦИЙ. Начисление создаётся UC-AFF-09 ДО этого шага, здесь мы
 * только зачисляем деньги и фиксируем статус. Если дебет/кредит упадёт,
 * начисление останется в статусе pending и следующий прогон попробует снова —
 * это осознанный «at-least-once с идемпотентностью», а не потеря денег.
 */
import { Inject, Injectable, Logger } from '@nestjs/common'

import { errorMessage } from '@/common/utils/error-message'

import type { Currency } from '@casino/shared-types'

import { WalletFacade } from '../../../wallet/application/wallet.facade'
import {
  AFFILIATE_COMMISSION_REPOSITORY,
  AFFILIATE_REPOSITORY,
  type AffiliateCommissionRepository,
  type AffiliateRepository,
} from '../../domain/repositories/affiliate.repository'

export interface CreditCommissionInput {
  commissionId: string
}

export type CreditCommissionResult =
  | { status: 'credited'; ledgerEntryId: string; amount: string }
  | { status: 'duplicate'; ledgerEntryId: string; amount: string }
  | { status: 'skipped'; reason: 'not_found' | 'already_cancelled' | 'already_credited' }

@Injectable()
export class CreditCommissionUseCase {
  private readonly logger = new Logger(CreditCommissionUseCase.name)

  constructor(
    @Inject(AFFILIATE_REPOSITORY) private readonly affiliates: AffiliateRepository,
    @Inject(AFFILIATE_COMMISSION_REPOSITORY)
    private readonly commissions: AffiliateCommissionRepository,
    @Inject(WalletFacade) private readonly walletFacade: WalletFacade,
  ) {}

  async execute(input: CreditCommissionInput): Promise<CreditCommissionResult> {
    const commission = await this.commissions.findById(input.commissionId)
    if (commission === null) {
      return { status: 'skipped', reason: 'not_found' }
    }
    if (commission.status === 'cancelled') {
      return { status: 'skipped', reason: 'already_cancelled' }
    }
    if (commission.status === 'approved' && commission.creditedAt !== null) {
      return { status: 'skipped', reason: 'already_credited' }
    }

    const affiliate = await this.affiliates.findById(commission.affiliateId)
    if (affiliate === null) {
      this.logger.error(`Affiliate ${commission.affiliateId} missing for ${commission.id}`)
      return { status: 'skipped', reason: 'not_found' }
    }

    // Кредит на кошелёк ПАРТНЁРА (не игрока): у affiliate есть userId, поэтому
    // работает обычный WalletFacade и вывод идёт через общую кассу.
    const result = await this.walletFacade.credit({
      userId: affiliate.userId,
      currency: commission.currency as Currency,
      amount: commission.commissionAmount,
      type: 'CONVERSION_CREDIT',
      idempotencyKey: `aff_${commission.id}`,
      description: `Affiliate commission ${commission.periodStart.toISOString().slice(0, 10)}`,
      metadata: {
        commissionId: commission.id,
        affiliateId: affiliate.id,
        playerId: commission.playerId,
        ngrAmount: commission.ngrAmount,
        revshareRate: commission.revshareRate,
      },
    })

    if (result.duplicate && commission.ledgerEntryId !== null) {
      return {
        status: 'duplicate',
        ledgerEntryId: commission.ledgerEntryId,
        amount: commission.commissionAmount,
      }
    }

    await this.commissions.markCredited(commission.id, result.ledgerEntryId, new Date())
    await this.affiliates.addEarned(affiliate.id, commission.commissionAmount)

    this.logger.log(
      `Affiliate commission credited: id=${commission.id} affiliate=${affiliate.id} amount=${commission.commissionAmount} ${commission.currency}`,
    )
    return {
      status: 'credited',
      ledgerEntryId: result.ledgerEntryId,
      amount: commission.commissionAmount,
    }
  }

  /**
   * Кредит с проглатыванием ошибки — для batch-расчёта.
   *
   * Одна неудачная начисление не должна останавливать весь суточный прогон:
   * начисление останется pending и будет повторено. Ошибка логируется.
   */
  async executeSafe(input: CreditCommissionInput): Promise<CreditCommissionResult> {
    try {
      return await this.execute(input)
    } catch (err) {
      this.logger.error(`Failed to credit commission ${input.commissionId}: ${errorMessage(err)}`)
      return { status: 'skipped', reason: 'not_found' }
    }
  }
}
