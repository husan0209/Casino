/**
 * ТЗ ч.9 §7 — адаптивный RTP.
 *
 * Порядок шагов §7.1: диапазон фазы → интерполяция по Score → поведенческая
 * поправка → компенсация дрейфа → сглаживание (§7.3) → глобальная отсечка.
 *
 * Значения денежных величин не участвуют: RTP — проценты, они остаются
 * числами и превращаются в строку только на границе `moneyRtpPercent`.
 */
import { Decimal } from 'decimal.js'

import { RTP_RANGES, type EngagementConfig } from './engagement-config'
import { calculateBehaviorModifier, type PlayerBehaviorSignals } from './player-behavior.vo'

import type { EngagementPhase } from './engagement-phase'
import type { EngagementState } from './engagement-state.vo'

export interface RtpAdjustment {
  /** Итоговый RTP спина в процентах. */
  readonly rtpPercent: number
  /** RTP фазы без поправок — для логов и §11.2. */
  readonly phaseTargetPercent: number
  readonly behaviorModifier: number
  readonly driftCompensation: number
  /** Отсечку сработала глобальная граница §17. */
  readonly clampedByGlobalBounds: boolean
  /** Отсечку сработала потолок таблицы выплат (houseSlotRtpCeiling). */
  readonly clampedByTableCeiling: boolean
  readonly appliedSmoothing: boolean
}

export interface AdjustRtpInput {
  /** Базовый RTP игры, проценты (games.rtp через moneyRtpPercent). */
  readonly baseRtpPercent: number
  readonly score: number
  readonly phase: EngagementPhase
  readonly signals: PlayerBehaviorSignals
  readonly state: EngagementState
  readonly config: EngagementConfig
  /** Потолок таблицы выплат; null, если вычислять нечем. */
  readonly tableCeilingPercent?: number | null
  /** RTP предыдущего спина — для сглаживания §7.3. */
  readonly previousRtpPercent?: number | null
  /**
   * §12.2 — у групп A/B/C адаптивный RTP может быть выключен: спин играет
   * базовым RTP игры без интерполяции по Score, поведенческих поправок и
   * компенсации дрейфа. По умолчанию включён.
   */
  readonly adaptiveRtpEnabled?: boolean
}

/** §7.1 шаг 1–2: диапазон фазы + линейная интерполяция по Score. */
export function phaseTargetRtp(phase: EngagementPhase, score: number): number {
  const range = RTP_RANGES[phase]
  const ratio = clamp(score, 0, 100) / 100
  return range.min + (range.max - range.min) * ratio
}

/** §7.1 шаг 4: дрейф ниже порога — шум, компенсации нет. Дрейф в п.п. */
export function compensateRtpDrift(
  targetRtp: number,
  rtpDrift: string,
  config: EngagementConfig,
): number {
  const drift = new Decimal(rtpDrift).toNumber()
  if (!Number.isFinite(drift)) {
    return targetRtp
  }
  if (Math.abs(drift) < config.driftNoiseThreshold) {
    return targetRtp
  }
  // Коэффициент 0.1 от дрейфа, максимум 3 п.п. — плавный возврат к плану (§7.1).
  const compensation = Math.sign(drift) * Math.min(Math.abs(drift) * 0.1, 3)
  // Казино отдало больше плана (drift > 0) → следующий RTP ниже, и наоборот.
  return targetRtp - compensation
}

/** §7.3: не больше maxChangePerSpin п.п. за спин. */
export function smoothRtpTransition(
  currentRtp: number,
  targetRtp: number,
  maxChangePerSpin: number,
): number {
  const diff = targetRtp - currentRtp
  if (Math.abs(diff) <= maxChangePerSpin) {
    return targetRtp
  }
  return currentRtp + Math.sign(diff) * maxChangePerSpin
}

/** §5.3/§12.2 — базовый RTP игры без манипуляций (терминальные фазы, группы A/B/C). */
function settledAdjustment(
  phaseTargetPercent: number,
  baseRtpPercent: number,
  config: EngagementConfig,
): RtpAdjustment {
  const settled = clamp(baseRtpPercent, config.rtpMinPercent, config.rtpMaxPercent)
  return {
    rtpPercent: settled,
    phaseTargetPercent,
    behaviorModifier: 0,
    driftCompensation: 0,
    clampedByGlobalBounds: settled !== baseRtpPercent,
    clampedByTableCeiling: false,
    appliedSmoothing: false,
  }
}

export function adjustRtp(input: AdjustRtpInput): RtpAdjustment {
  const { baseRtpPercent, score, phase, signals, state, config } = input

  const phaseTarget = phaseTargetRtp(phase, score)

  // COOLDOWN/DORMANT §5.3 — базовый RTP игры без манипуляций: фаза означает
  // «игрок выгорел, крутим честно», никаких поведенческих поправок.
  if (phase === 'cooldown' || phase === 'dormant') {
    return settledAdjustment(phaseTarget, baseRtpPercent, config)
  }

  // §12.2 — группы A/B/C без адаптивного RTP: базовый RTP игры, но состояние,
  // счётчики и журнал продолжают вестись — иначе группы не с чем сравнивать.
  if (input.adaptiveRtpEnabled === false) {
    return settledAdjustment(phaseTarget, baseRtpPercent, config)
  }

  const behaviorModifier = calculateBehaviorModifier(signals)
  const withBehavior = phaseTarget + behaviorModifier
  const withDrift = compensateRtpDrift(withBehavior, state.rtpDrift, config)

  let result = withDrift
  let appliedSmoothing = false
  if (input.previousRtpPercent !== undefined && input.previousRtpPercent !== null) {
    const smoothed = smoothRtpTransition(
      input.previousRtpPercent,
      withDrift,
      config.maxRtpChangePerSpin,
    )
    appliedSmoothing = smoothed !== withDrift
    result = smoothed
  }

  let clampedByGlobalBounds = false
  const bounded = clamp(result, config.rtpMinPercent, config.rtpMaxPercent)
  clampedByGlobalBounds = bounded !== result
  result = bounded

  // §17/§7.2: физически таблица выплат может не выдать больше потолка.
  let clampedByTableCeiling = false
  if (input.tableCeilingPercent !== undefined && input.tableCeilingPercent !== null) {
    if (result > input.tableCeilingPercent) {
      result = input.tableCeilingPercent
      clampedByTableCeiling = true
    }
  }

  return {
    rtpPercent: result,
    phaseTargetPercent: phaseTarget,
    behaviorModifier,
    driftCompensation: withDrift - withBehavior,
    clampedByGlobalBounds,
    clampedByTableCeiling,
    appliedSmoothing,
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min
  }
  if (value < min) {
    return min
  }
  if (value > max) {
    return max
  }
  return value
}
