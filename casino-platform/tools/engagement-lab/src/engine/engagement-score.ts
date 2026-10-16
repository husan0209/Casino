import { CHURN_RISK_PENALTIES, SCORE_WEIGHTS } from '../config'
import { type EngagementState, type PlayerBehaviorSignals } from '../domain/types'

/**
 * §1.4: Engagement Score — целочисленная шкала 0–100. Границы заданы самим
 * определением в ТЗ и отсутствуют в src/config.ts — объявлены локально.
 */
const SCORE_MIN = 0
const SCORE_MAX = 100

/**
 * §6.1 churnRiskPenalty: в ТЗ задан только диапазон 0–25 без формулы.
 * Считаем суммой весов сработавших признаков из CHURN_RISK_PENALTIES
 * (lab default, зафиксирован в src/config.ts) с потолком churnPenaltyCap.
 */
function churnRiskPenaltyOf(signals: PlayerBehaviorSignals): number {
  let penalty = 0
  if (signals.slowClicking) {
    penalty += CHURN_RISK_PENALTIES.slowClicking
  }
  if (signals.decreasingBetCount) {
    penalty += CHURN_RISK_PENALTIES.decreasingBetCount
  }
  if (signals.longPauseAfterLoss) {
    penalty += CHURN_RISK_PENALTIES.longPauseAfterLoss
  }
  if (signals.balanceNearZero) {
    penalty += CHURN_RISK_PENALTIES.balanceNearZero
  }
  return Math.min(penalty, SCORE_WEIGHTS.churnPenaltyCap)
}

/**
 * §6.1: Score = base + winStreakBonus - lossStreakPenalty + activityBonus -
 * churnRiskPenalty. Каждый компонент ограничен капом из SCORE_WEIGHTS,
 * итог округляется вниз (§1.4: целочисенная оценка) и зажимается в 0..100.
 * Деньги здесь не участвуют: все входы — счётчики и поведенческие сигналы.
 */
export function calculateEngagementScore(
  state: EngagementState,
  signals: PlayerBehaviorSignals,
): number {
  const winStreakBonus = Math.min(
    state.consecutiveWins * SCORE_WEIGHTS.winStreakStep,
    SCORE_WEIGHTS.winStreakCap,
  )
  const lossStreakPenalty = Math.min(
    state.consecutiveLosses * SCORE_WEIGHTS.lossStreakStep,
    SCORE_WEIGHTS.lossStreakCap,
  )
  const activityBonus = Math.min(
    signals.spinsInLast5Minutes * SCORE_WEIGHTS.activityStep,
    SCORE_WEIGHTS.activityCap,
  )
  const churnRiskPenalty = churnRiskPenaltyOf(signals)

  const rawScore =
    SCORE_WEIGHTS.base + winStreakBonus - lossStreakPenalty + activityBonus - churnRiskPenalty

  const integerScore = Math.floor(rawScore)
  return Math.min(Math.max(integerScore, SCORE_MIN), SCORE_MAX)
}
