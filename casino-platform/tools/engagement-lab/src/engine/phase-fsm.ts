import { BALANCE_CYCLE, TIMING } from '../config'
import { EngagementPhase } from '../domain/engagement-phase'
import { type EngagementState, type PlayerBehaviorSignals } from '../domain/types'

/**
 * §5.2 RETENTION→RISK требует 5+ последовательных проигрышей; это число есть
 * только в таблице guards из ТЗ и отсутствует в src/config.ts — объявлено здесь.
 */
const RISK_CONSECUTIVE_LOSSES_GUARD = 5

/**
 * §5.4: эвристика фазы — Stateless-альтернатива FSM: она игнорирует текущую
 * фазу и никогда не выдаёт COOLDOWN/DORMANT. Оркестратор гадает по FSM (§5.2);
 * эта функция нужна для сравнения двух алгоритмов на одном прогоне (§12).
 *
 * Расхождение с §5.2 на одном входе (зафиксировано тестом): RISK здесь требует
 * признаков ухода (longPauseAfterLoss / decreasingBetCount /
 * avgTimeBetweenSpins > 15 сек), а FSM достаточно slowClicking или
 * consecutiveLosses >= 5; REACTIVATION здесь опирается на
 * counters.reactivationTriggered, а FSM — на баланс и reactivationCount.
 */
export function determinePhase(
  state: EngagementState,
  signals: PlayerBehaviorSignals,
): EngagementPhase {
  // ONBOARDING: пока не набран ONBOARDING_SPIN_THRESHOLD спинов
  // И подушка (< BALANCE_CYCLE.pillowRatioMin) ещё не сформирована (§5.4).
  if (
    state.totalSpins < BALANCE_CYCLE.onboardingSpinThreshold &&
    signals.balanceRatio < BALANCE_CYCLE.pillowRatioMin
  ) {
    return EngagementPhase.ONBOARDING
  }

  // REACTIVATION: только что триггерили реактивацию. Порог < 3 совпадает
  // с spinsToLeaveReactivation из §5.2 — тот же смысл «отсидеть в фазе».
  if (
    state.counters.reactivationTriggered &&
    state.counters.spinsSinceReactivation < BALANCE_CYCLE.spinsToLeaveReactivation
  ) {
    return EngagementPhase.REACTIVATION
  }

  // RISK: баланс < 50 % И признаки ухода (§5.4; avgTimeBetweenSpins > 15 сек
  // — тот же slowSpinIntervalMs, что и в определениях сигналов §6.2).
  const showsChurnEvidence =
    signals.longPauseAfterLoss ||
    signals.decreasingBetCount ||
    signals.avgTimeBetweenSpins > TIMING.slowSpinIntervalMs
  if (signals.balanceRatio < BALANCE_CYCLE.riskBalanceRatio && showsChurnEvidence) {
    return EngagementPhase.RISK
  }

  // RETENTION: по умолчанию.
  return EngagementPhase.RETENTION
}

/**
 * §5.2: переходы FSM по таблице guards. Возвращает фазу после проверки
 * guards для ТЕКУЩЕЙ фазы state; если guard не сработал — фаза не меняется.
 * Бонус-действие при RISK→REACTIVATION и сброс механик при REACTIVATION→
 * COOLDOWN исполняет оркестратор (§9.1), здесь только чистые предикаты.
 */
export function nextPhaseByGuards(
  state: EngagementState,
  signals: PlayerBehaviorSignals,
  now: Date,
): EngagementPhase {
  // *→DORMANT по неактивности > TIMING.dormantAfterMs (§5.1, §5.2): строго
  // больше — ровно 30 минут ещё не DORMANT. Единственный выход из COOLDOWN.
  const inactivityMs = now.getTime() - state.lastActivityAt.getTime()
  if (inactivityMs > TIMING.dormantAfterMs) {
    return EngagementPhase.DORMANT
  }

  // DORMANT: механики не применяются, исходящих переходов в таблице нет.
  if (state.engagementPhase === EngagementPhase.DORMANT) {
    return EngagementPhase.DORMANT
  }

  // §5.1: COOLDOWN терминальна — из неё разрешён только DORMANT (проверен выше).
  if (state.engagementPhase === EngagementPhase.COOLDOWN) {
    return EngagementPhase.COOLDOWN
  }

  if (state.engagementPhase === EngagementPhase.ONBOARDING) {
    return nextPhaseFromOnboarding(state, signals)
  }
  if (state.engagementPhase === EngagementPhase.RETENTION) {
    return nextPhaseFromRetention(state, signals)
  }
  if (state.engagementPhase === EngagementPhase.RISK) {
    return nextPhaseFromRisk(state, signals)
  }
  if (state.engagementPhase === EngagementPhase.REACTIVATION) {
    return nextPhaseFromReactivation(state, signals)
  }
  return state.engagementPhase
}

/** §5.2 ONBOARDING→RETENTION: totalSpins >= 15 ИЛИ balanceRatio >= 1.25. */
function nextPhaseFromOnboarding(
  state: EngagementState,
  signals: PlayerBehaviorSignals,
): EngagementPhase {
  const spunEnough = state.totalSpins >= BALANCE_CYCLE.onboardingSpinThreshold
  const pillowGoalReached = signals.balanceRatio >= BALANCE_CYCLE.onboardingTargetRatio
  if (spunEnough || pillowGoalReached) {
    return EngagementPhase.RETENTION
  }
  return EngagementPhase.ONBOARDING
}

/**
 * §5.2 RETENTION→RISK: balanceRatio < 0.5 AND (slowClicking OR
 * consecutiveLosses >= 5).
 */
function nextPhaseFromRetention(
  state: EngagementState,
  signals: PlayerBehaviorSignals,
): EngagementPhase {
  const balanceFalling = signals.balanceRatio < BALANCE_CYCLE.riskBalanceRatio
  const churnSignalsPresent =
    signals.slowClicking || state.consecutiveLosses >= RISK_CONSECUTIVE_LOSSES_GUARD
  if (balanceFalling && churnSignalsPresent) {
    return EngagementPhase.RISK
  }
  return EngagementPhase.RETENTION
}

/**
 * §5.2 RISK→REACTIVATION: balanceRatio < 0.2 AND reactivationCount < MAX.
 * При reactivationCount >= MAX из RISK выхода нет (в таблице его не
 * описано) — остаёмся в RISK, оркестратор не получит бонус-триггер.
 */
function nextPhaseFromRisk(
  state: EngagementState,
  signals: PlayerBehaviorSignals,
): EngagementPhase {
  const atReactivationPoint = signals.balanceRatio < BALANCE_CYCLE.reactivationThresholdRatio
  const reactivationsLeft = state.reactivationCount < BALANCE_CYCLE.maxReactivations
  if (atReactivationPoint && reactivationsLeft) {
    return EngagementPhase.REACTIVATION
  }
  return EngagementPhase.RISK
}

/**
 * §5.2 REACTIVATION→COOLDOWN: reactivationCount >= MAX;
 * §5.2 REACTIVATION→RETENTION: balanceRatio >= 0.7 И
 * spinsSinceReactivation >= 3.
 * Оба guard'а могут быть истинны одновременно (четвёртая реактивация
 * догоняет баланс до 0.7+); порядок в ТЗ не задан — приоритет у COOLDOWN,
 * т.к. §5.1 определяет его как вход «после достижения максимума
 * реактиваций», и cycle-логика §4.2 требует «после — дать проиграть».
 */
function nextPhaseFromReactivation(
  state: EngagementState,
  signals: PlayerBehaviorSignals,
): EngagementPhase {
  if (state.reactivationCount >= BALANCE_CYCLE.maxReactivations) {
    return EngagementPhase.COOLDOWN
  }
  const balanceRecovered = signals.balanceRatio >= BALANCE_CYCLE.reactivationTargetRatioMin
  const heldEnoughSpins =
    state.counters.spinsSinceReactivation >= BALANCE_CYCLE.spinsToLeaveReactivation
  if (balanceRecovered && heldEnoughSpins) {
    return EngagementPhase.RETENTION
  }
  return EngagementPhase.REACTIVATION
}
