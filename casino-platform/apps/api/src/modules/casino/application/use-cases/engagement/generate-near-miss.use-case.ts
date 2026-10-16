/**
 * ТЗ ч.9 §8.2 — UC-ENG-05 GenerateNearMissUseCase.
 *
 * Частота Near-Miss зависит от фазы, выбор строки — от приоритета паттернов.
 * Оба решения возвращаются вызывающему: подмена исхода делается на стороне
 * спина, потому что она обязана быть видна в том же раунде и в том же
 * журнале, что и кредит.
 */
import { Injectable } from '@nestjs/common'

import {
  selectNearMissRow,
  type EngagementConfig,
  type EngagementPhase,
  type EngagementState,
  type RandomSource,
} from '../../../domain/engagement'

import type { HouseSlotPayoutModel, TigerSpinRow } from '../../../domain/house-slot-game'

export interface GenerateNearMissInput {
  state: EngagementState
  phase: EngagementPhase
  winRows: readonly TigerSpinRow[]
  payoutModel: HouseSlotPayoutModel
  config: EngagementConfig
  random: RandomSource
}

export interface NearMissOutcome {
  readonly applied: boolean
  readonly row: TigerSpinRow | null
  readonly pattern: string | null
  readonly reason: string
  readonly adjustedRate: number
  readonly event: {
    readonly eventType: 'near_miss_applied'
    readonly payload: Record<string, unknown>
  } | null
}

@Injectable()
export class GenerateNearMissUseCase {
  execute(input: GenerateNearMissInput): NearMissOutcome {
    const decision = selectNearMissRow({
      winRows: input.winRows,
      payoutModel: input.payoutModel,
      phase: input.phase,
      config: input.config,
      random: input.random,
    })

    if (!decision.row) {
      return {
        applied: false,
        row: null,
        pattern: null,
        reason: decision.reason,
        adjustedRate: decision.adjustedRate,
        event: null,
      }
    }

    return {
      applied: true,
      row: decision.row,
      pattern: decision.pattern?.name ?? null,
      reason: decision.reason,
      adjustedRate: decision.adjustedRate,
      event: {
        eventType: 'near_miss_applied',
        payload: {
          phase: input.phase,
          pattern: decision.pattern?.name ?? null,
          adjustedRate: decision.adjustedRate,
          spinIndex: input.state.totalSpins,
        },
      },
    }
  }
}
