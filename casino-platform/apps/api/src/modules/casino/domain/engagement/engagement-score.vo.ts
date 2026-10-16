/**
 * ТЗ ч.9 §6.1 — Engagement Score (0–100).
 *
 * Score не хранится: он выводится из состояния и кэшируется на 5 минут (§6.4),
 * потому что меняется медленно и читается на каждом спине.
 */
import { Decimal } from 'decimal.js'

import type { MoneyAmount } from '@casino/shared-types'

import { balanceRatioOf } from './engagement-state.vo'
import {
  computeBehaviorSignals,
  hasChurnRisk,
  type PlayerBehaviorSignals,
} from './player-behavior.vo'

import type { EngagementState } from './engagement-state.vo'

export interface EngagementScore {
  /** 0–100. */
  readonly value: number
  readonly base: number
  readonly winStreakBonus: number
  readonly lossStreakPenalty: number
  readonly activityBonus: number
  readonly churnRiskPenalty: number
}

const BASE_SCORE = 50
const WIN_STREAK_STEP = 5
const WIN_STREAK_MAX = 20
const LOSS_STREAK_STEP = 4
const LOSS_STREAK_MAX = 30
const ACTIVITY_STEP = 0.5
const ACTIVITY_MAX = 15
const CHURN_PENALTY_MAX = 25

/** Длина текущей серии выигрышей/проигрышей на конце буфера. */
function streaks(state: EngagementState): { wins: number; losses: number } {
  const spins = state.behavior.spins
  let wins = 0
  let losses = 0
  for (let i = spins.length - 1; i >= 0; i--) {
    const record = spins[i]
    if (!record) {
      break
    }
    if (record.isWin) {
      if (losses > 0) {
        break
      }
      wins++
    } else {
      if (wins > 0) {
        break
      }
      losses++
    }
  }
  return { wins, losses }
}

export function calculateEngagementScore(
  state: EngagementState,
  currentBalance: MoneyAmount,
  now: number = Date.now(),
): EngagementScore {
  const signals = computeBehaviorSignals(state, currentBalance, now)
  return calculateEngagementScoreFromSignals(state, signals)
}

/** Раздельный вход для мест, где сигналы уже посчитаны (на спине это всегда так). */
export function calculateEngagementScoreFromSignals(
  state: EngagementState,
  signals: PlayerBehaviorSignals,
): EngagementScore {
  const { wins, losses } = streaks(state)

  const winStreakBonus = Math.min(wins * WIN_STREAK_STEP, WIN_STREAK_MAX)
  const lossStreakPenalty = Math.min(losses * LOSS_STREAK_STEP, LOSS_STREAK_MAX)

  // Активность считаем по спинам окна §6.2: «живой» игрок в последние 5 минут.
  const activityBonus = Math.min(
    Decimal.min(
      new Decimal(signals.spinsInLast5Minutes).times(ACTIVITY_STEP),
      ACTIVITY_MAX,
    ).toNumber(),
    ACTIVITY_MAX,
  )

  // Штраф за риск ухода: 25 за «всё сразу», но не выше суммарной активности,
  // иначе новичок с двумя спинами получает Score 0 и максимальный штраф RTP.
  const churnRiskPenalty = hasChurnRisk(signals)
    ? Math.min(CHURN_PENALTY_MAX, winStreakBonus + activityBonus)
    : 0

  const value = clampScore(
    BASE_SCORE + winStreakBonus - lossStreakPenalty + activityBonus - churnRiskPenalty,
  )

  return {
    value,
    base: BASE_SCORE,
    winStreakBonus,
    lossStreakPenalty,
    activityBonus,
    churnRiskPenalty,
  }
}

function clampScore(value: number): number {
  if (value < 0) {
    return 0
  }
  if (value > 100) {
    return 100
  }
  return value
}

/** Относительное положение баланса в цикле — используется логированием и §4.1. */
export function balanceRatio(state: EngagementState, currentBalance: MoneyAmount): number {
  return balanceRatioOf(state, currentBalance)
}
