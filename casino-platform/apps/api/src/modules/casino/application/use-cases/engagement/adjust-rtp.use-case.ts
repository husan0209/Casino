/**
 * ТЗ ч.9 §7 — UC-ENG-02 AdjustRtpUseCase.
 *
 * Считает RTP спина и готовит событие `rtp_adjusted` для журнала §11.3.
 * Само событие пишет UC-ENG-05 в общей транзакции со спином.
 */
import { Injectable } from '@nestjs/common'

import {
  adjustRtp,
  type EngagementConfig,
  type EngagementPhase,
  type EngagementState,
  type PlayerBehaviorSignals,
  type RtpAdjustment,
} from '../../../domain/engagement'

export interface AdjustRtpInput {
  /** Базовый RTP игры в процентах (games.rtp через moneyRtpPercent). */
  baseRtpPercent: number
  score: number
  phase: EngagementPhase
  signals: PlayerBehaviorSignals
  state: EngagementState
  config: EngagementConfig
  tableCeilingPercent: number | null
  previousRtpPercent?: number | null
  /** §12.2 — у групп A/B/C адаптивный RTP может быть выключен (базовый RTP игры). */
  adaptiveRtpEnabled?: boolean
}

export interface AdjustRtpResult {
  readonly adjustment: RtpAdjustment
  /** Строка для RTP в колонке moneyRtpPercent (проценты → кошелёк). */
  readonly rtpPercentString: string
  readonly event: {
    readonly eventType: 'rtp_adjusted'
    readonly payload: Record<string, unknown>
  }
}

@Injectable()
export class AdjustRtpUseCase {
  execute(input: AdjustRtpInput): AdjustRtpResult {
    const adjustment = adjustRtp(input)
    const rtpPercentString = adjustment.rtpPercent.toFixed(2)

    return {
      adjustment,
      rtpPercentString,
      event: {
        eventType: 'rtp_adjusted',
        payload: {
          baseRtpPercent: input.baseRtpPercent,
          rtpPercent: adjustment.rtpPercent,
          phaseTargetPercent: adjustment.phaseTargetPercent,
          behaviorModifier: adjustment.behaviorModifier,
          driftCompensation: adjustment.driftCompensation,
          score: input.score,
          phase: input.phase,
          adaptiveRtpEnabled: input.adaptiveRtpEnabled ?? true,
          clampedByGlobalBounds: adjustment.clampedByGlobalBounds,
          clampedByTableCeiling: adjustment.clampedByTableCeiling,
          appliedSmoothing: adjustment.appliedSmoothing,
        },
      },
    }
  }
}
