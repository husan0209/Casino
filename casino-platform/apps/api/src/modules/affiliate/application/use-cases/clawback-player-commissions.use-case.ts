/**
 * Clawback начислений при самоисключении игрока (ТЗ ч.8 §14.1, решение C).
 *
 * ЗАЧЕМ. Игрок нажимает «заблокировать себя» — это осознанный отказ от игры.
 * Партнёр не должен зарабатывать на таком игроке: это одновременно
 * ответственная игра и партнёрский фрод. Поэтому начисления, уже зачисленные
 * на кошелёк партнёра, отменяются, а деньги списываются обратно.
 *
 * ПОЧЕМУ ПОСЛЕДАТЕЛЬНО, А НЕ НА ЭТАПЕ АТРИБУЦИИ. Раньше я предлагал вариант A —
 * не привязывать самоисключённого к партнёру. Вариант C выбран владельцем
 * сознательно, и он сильнее: атрибуция остаётся (история видна, партнёр не
 * теряет статистику), а лишние деньги реально возвращаются. Цена решения —
 * компенсирующая проводка и риск нехватки средств у партнёра, который
 * обработан явно (см. ClawbackResult.insufficientFunds).
 *
 * ИДEMPОТЕНТНОСТЬ. Ключ дебета — aff_clawback_{commissionId}. Повторный вызов
 * (ретрай события, рестарт воркера) не спишет деньги дважды: WalletFacade
 * вернёт duplicate.
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import { Decimal } from 'decimal.js'

import { errorMessage } from '@/common/utils/error-message'

import type { Currency } from '@casino/shared-types'
import { money } from '@casino/shared-utils'

import { WalletFacade } from '../../../wallet/facade/wallet.facade'
import {
  AFFILIATE_ATTRIBUTION_REPOSITORY,
  AFFILIATE_COMMISSION_REPOSITORY,
  AFFILIATE_REPOSITORY,
  type AffiliateAttributionRepository,
  type AffiliateCommissionRepository,
  type AffiliateRepository,
} from '../../domain/repositories/affiliate.repository'

import type { AffiliateCommissionEntity } from '../../domain/entities/affiliate.entity'

/** Причина отмены в audit-логе и в интерфейсе партнёра. */
export const CLAWBACK_REASON = 'self_exclusion'

/** Начисления в этих статусах можно отменить. paid/cancelled — уже финальны. */
const REVERSIBLE_STATUSES = ['pending', 'approved'] as const

export interface ClawbackPlayerInput {
  playerId: string
}

/** Начисление, деньги по которому вернуть не удалось. */
export interface UnrecoverableItem {
  commissionId: string
  amount: string
  currency: string
}

export interface ClawbackResult {
  /** Начисление найдено у партнёра. */
  checked: boolean
  /** Начислений отменено (в т.ч. ещё не зачисленных). */
  cancelled: number
  /** Списано денег с кошелька партнёра. */
  reversedAmount: string
  /**
   * Невозвратные суммы: у партнёра не хватило средств для компенсации
   * (обычно потому, что он уже вывел заработок). Требуют ручного разбора —
   * поэтому возвращаются наружу, а не глушатся.
   */
  insufficientFunds: UnrecoverableItem[]
  /** Ошибки отдельных начислений — не должны ронять весь прогон. */
  errors: string[]
}

@Injectable()
export class ClawbackPlayerCommissionsUseCase {
  private readonly logger = new Logger(ClawbackPlayerCommissionsUseCase.name)

  // eslint-disable-next-line max-params -- Nest DI: состав конструктора задаётся графом зависимостей (GAP-25)
  constructor(
    @Inject(AFFILIATE_REPOSITORY) private readonly affiliates: AffiliateRepository,
    @Inject(AFFILIATE_COMMISSION_REPOSITORY)
    private readonly commissions: AffiliateCommissionRepository,
    @Inject(AFFILIATE_ATTRIBUTION_REPOSITORY)
    private readonly attributions: AffiliateAttributionRepository,
    @Inject(WalletFacade) private readonly walletFacade: WalletFacade,
  ) {}

  async execute(input: ClawbackPlayerInput): Promise<ClawbackResult> {
    const result: ClawbackResult = {
      checked: false,
      cancelled: 0,
      reversedAmount: '0',
      insufficientFunds: [],
      errors: [],
    }

    const attribution = await this.attributions.findByPlayerId(input.playerId)
    if (attribution === null) {
      return result
    }
    result.checked = true

    const rows = await this.commissions.listCreditableByPlayer({
      playerId: input.playerId,
      statuses: [...REVERSIBLE_STATUSES],
    })

    for (const row of rows) {
      try {
        const outcome = await this.reverseOne(row)
        result.cancelled += 1
        if (outcome.reversed !== null) {
          // money.add возвращает нормализованную строку ("350.5"), а наружу
          // сумма должна уходить в едином формате DECIMAL(20,8) — иначе
          // значение из clawback нельзя напрямую скормить money.add ещё раз.
          const summed = money.add(result.reversedAmount, outcome.reversed)
          result.reversedAmount = new Decimal(summed).toFixed(8)
        }
        if (outcome.unrecoverable !== null) {
          result.insufficientFunds.push(outcome.unrecoverable)
        }
      } catch (err) {
        this.logger.error(`Clawback failed for commission ${row.id}: ${errorMessage(err)}`)
        result.errors.push(`${row.id}: ${errorMessage(err)}`)
      }
    }

    await this.attributions
      .cancelForCompliance(attribution.id, CLAWBACK_REASON)
      .catch((err: unknown) => {
        this.logger.error(`Failed to cancel attribution ${attribution.id}: ${errorMessage(err)}`)
      })

    this.logger.warn(
      `Affiliate clawback for self-excluded player ${input.playerId}: cancelled=${result.cancelled} unrecoverable=${result.insufficientFunds.length}`,
    )
    return result
  }

  /**
   * Отменяет одно начисление и возвращает деньги партнёру.
   *
   * Порядок операций: сначала деньги, потом статус. Обратный порядок оставил бы
   * запись в статусе cancelled при неудачном дебете — деньги у партнёра остались
   * бы, а система считала бы, что отменила.
   */
  private async reverseOne(
    row: AffiliateCommissionEntity,
  ): Promise<{ reversed: string | null; unrecoverable: UnrecoverableItem | null }> {
    const notCredited: { reversed: null; unrecoverable: null } = {
      reversed: null,
      unrecoverable: null,
    }

    // pending / approved без creditedAt — денежной проводки не было,
    // достаточно перевести в cancelled.
    if (row.status === 'pending' || row.creditedAt === null) {
      await this.commissions.markCancelled(row.id)
      return notCredited
    }

    const affiliate = await this.affiliates.findById(row.affiliateId)
    if (affiliate === null) {
      this.logger.error(`Affiliate ${row.affiliateId} not found for clawback of ${row.id}`)
      return notCredited
    }

    try {
      await this.walletFacade.debit({
        userId: affiliate.userId,
        currency: row.currency as Currency,
        amount: row.commissionAmount,
        type: 'ADMIN_DEBIT',
        idempotencyKey: `aff_clawback_${row.id}`,
        description: `Affiliate clawback (${CLAWBACK_REASON}) for commission ${row.id}`,
        metadata: {
          commissionId: row.id,
          affiliateId: row.affiliateId,
          reason: CLAWBACK_REASON,
        },
      })
    } catch (err) {
      const unrecoverable: UnrecoverableItem = {
        commissionId: row.id,
        amount: row.commissionAmount,
        currency: row.currency,
      }
      this.logger.error(
        `Clawback unrecoverable: commission=${row.id} amount=${row.commissionAmount} ${row.currency} affiliateUser=${affiliate.userId} — ${errorMessage(err)}`,
      )
      await this.commissions.markCancelled(row.id)
      return { reversed: null, unrecoverable }
    }

    await this.commissions.markCancelled(row.id)
    await this.affiliates.addEarned(row.affiliateId, `-${row.commissionAmount}`)
    return { reversed: row.commissionAmount, unrecoverable: null }
  }
}
