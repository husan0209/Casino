/**
 * ТЗ ч.9 §8.1 — UC-ENG-04 SelectLdwUseCase.
 *
 * Решает, применять ли LDW на этом спине, и подбирает строку выплаты в окне
 * 30–60 % ставки. Решение и выбор строки разнесены (§8.1), потому что окно
 * может оказаться пустым: тогда спин идёт как обычный, без подмены исхода.
 */
import { Injectable } from '@nestjs/common'

import {
  shouldApplyLdw,
  selectLdwRow,
  spinsSinceLastLdw,
  type EngagementConfig,
  type EngagementPhase,
  type EngagementState,
  type RandomSource,
} from '../../../domain/engagement'

import type { HouseSlotPayoutModel, TigerSpinRow } from '../../../domain/house-slot-game'

export interface SelectLdwInput {
  state: EngagementState
  /** Фаза спина — уже пересчитанная FSM, а не фаза на входе спина. */
  phase: EngagementPhase
  winRows: readonly TigerSpinRow[]
  payoutModel: HouseSlotPayoutModel
  config: EngagementConfig
  random: RandomSource
}

export interface LdwOutcome {
  readonly applied: boolean
  readonly row: TigerSpinRow | null
  readonly reason: string
  readonly targetInterval: number
  readonly event: {
    readonly eventType: 'ldw_applied'
    readonly payload: Record<string, unknown>
  } | null
}

@Injectable()
export class SelectLdwUseCase {
  execute(input: SelectLdwInput): LdwOutcome {
    const decision = shouldApplyLdw({
      phase: input.phase,
      spinsSinceLastLdw: spinsSinceLastLdw(input.state),
      config: input.config,
      random: input.random,
    })

    if (!decision.apply) {
      return {
        applied: false,
        row: null,
        reason: decision.reason,
        targetInterval: decision.targetInterval,
        event: null,
      }
    }

    const selection = selectLdwRow({
      winRows: input.winRows,
      payoutModel: input.payoutModel,
      config: input.config,
      random: input.random,
    })

    if (!selection.row) {
      return {
        applied: false,
        row: null,
        reason: selection.reason,
        targetInterval: decision.targetInterval,
        event: null,
      }
    }

    return {
      applied: true,
      row: selection.row,
      reason: selection.reason,
      targetInterval: decision.targetInterval,
      event: {
        eventType: 'ldw_applied',
        payload: {
          phase: input.phase,
          spinsSinceLastLdw: spinsSinceLastLdw(input.state),
          targetInterval: decision.targetInterval,
          spinIndex: input.state.totalSpins,
        },
      },
    }
  }
}
