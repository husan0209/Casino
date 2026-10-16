/**
 * ТЗ ч.9 §5.2 — конечный автомат фаз.
 *
 * FSM чистая функция: на входе состояние, баланс и поведенческие сигналы,
 * на выходе следующая фаза и причина перехода. Мутаций и БД здесь нет —
 * этим занимается EngagementEngineService.
 *
 * Вызывается ДО генерации исхода спина, чтобы механики LDW/Near-Miss
 * применялись уже в новой фазе: спин, на котором игрок ушёл в COOLDOWN,
 * тоже должен быть «чистым» (§17).
 */
import type { MoneyAmount } from '@casino/shared-types'

import { BALANCE_THRESHOLDS } from './engagement-config'
import { balanceRatioOf } from './engagement-state.vo'
import { hasChurnRisk, type PlayerBehaviorSignals } from './player-behavior.vo'

import type { EngagementConfig } from './engagement-config'
import type { EngagementPhase } from './engagement-phase'
import type { EngagementState } from './engagement-state.vo'

export interface PhaseTransition {
  readonly phase: EngagementPhase
  readonly changed: boolean
  /** Человекочитаемая причина — уходит в лог и в engagement_events (§11.3). */
  readonly reason: string
}

export interface PhaseGuardInput {
  readonly state: EngagementState
  readonly currentBalance: MoneyAmount
  readonly signals: PlayerBehaviorSignals
  readonly config: EngagementConfig
  /** Сессия закрыта — прямой переход в DORMANT (§5.2, строка «* → DORMANT»). */
  readonly sessionEnded?: boolean
  /** Метка времени спина, мс epoch. */
  readonly now?: number
}

/** §4.3 — спинов с последней реактивации; null = реактиваций не было. */
export function spinsSinceReactivation(state: EngagementState): number | null {
  return state.lastReactivationSpin === null ? null : state.totalSpins - state.lastReactivationSpin
}

/**
 * §5.2 — следующая фаза. Порядок проверок совпадает с таблицей переходов
 * и определяет приоритет: терминальные состояния проверяются первыми,
 * чтобы из COOLDOWN нельзя было «выскочить» обратно в вовлечение.
 */
export function nextPhase(input: PhaseGuardInput): PhaseTransition {
  const { state, currentBalance, signals, config, sessionEnded = false } = input
  const now = input.now ?? Date.now()

  if (sessionEnded) {
    return transition(state.phase, 'dormant', 'session_ended')
  }

  // §5.2 COOLDOWN → DORMANT: без активности дольше 30 минут.
  if (state.phase === 'cooldown' || state.phase === 'dormant') {
    if (isInactiveTooLong(state, now)) {
      return transition(state.phase, 'dormant', 'inactive_over_30_min')
    }
    return transition(state.phase, state.phase, 'terminal_phase_hold')
  }

  const guards: Record<EngagementPhase, (ctx: GuardContext) => PhaseTransition> = {
    onboarding: fromOnboarding,
    retention: fromRetention,
    risk: fromRisk,
    reactivation: fromReactivation,
    cooldown: holdPhase,
    dormant: holdPhase,
  }

  return guards[state.phase]({
    state,
    currentBalance,
    ratio: balanceRatioOf(state, currentBalance),
    signals,
    config,
  })
}

interface GuardContext {
  state: EngagementState
  currentBalance: MoneyAmount
  ratio: number
  signals: PlayerBehaviorSignals
  config: EngagementConfig
}

/** §5.2 ONBOARDING → RETENTION: хватило спинов или достигнута подушка. */
function fromOnboarding(ctx: GuardContext): PhaseTransition {
  const { state, ratio, config } = ctx
  if (state.totalSpins >= config.onboardingSpinThreshold) {
    return transition(state.phase, 'retention', 'spins_threshold')
  }
  if (ratio >= config.onboardingBalanceTargetRatio) {
    return transition(state.phase, 'retention', 'pillar_target_reached')
  }
  return transition(state.phase, 'onboarding', 'onboarding_hold')
}

/** §5.2 RETENTION → RISK: половина базы плюс признаки ухода. */
function fromRetention(ctx: GuardContext): PhaseTransition {
  const { state, ratio, signals } = ctx
  if (ratio < BALANCE_THRESHOLDS.riskRatio && hasChurnRisk(signals)) {
    return transition(state.phase, 'risk', 'balance_below_half_and_churn')
  }
  if (ratio < BALANCE_THRESHOLDS.reactivationRatio) {
    // Критическая точка без признаков ухода: ждём реактивации, но RISK не включаем.
    return transition(state.phase, 'retention', 'below_critical_without_churn')
  }
  return transition(state.phase, 'retention', 'retention_hold')
}

/** §5.2 RISK → REACTIVATION: баланс ниже критической точки. */
function fromRisk(ctx: GuardContext): PhaseTransition {
  const { state, ratio } = ctx
  if (ratio < BALANCE_THRESHOLDS.reactivationRatio) {
    return transition(state.phase, 'reactivation', 'below_critical_point')
  }
  if (ratio >= BALANCE_THRESHOLDS.recoveryRatio) {
    return transition(state.phase, 'retention', 'recovered_without_bonus')
  }
  return transition(state.phase, 'risk', 'risk_hold')
}

/**
 * §5.2 REACTIVATION: возврат в RETENTION по восстановленному балансу либо
 * COOLDOWN по исчерпанию лимита. Лимит 0 = бонусы отключены оператором.
 */
function fromReactivation(ctx: GuardContext): PhaseTransition {
  const { state, ratio, config } = ctx
  if (state.reactivationCount >= config.maxReactivations) {
    return transition(state.phase, 'cooldown', 'reactivation_limit_reached')
  }
  const since = spinsSinceReactivation(state)
  const spunOut = since !== null && since >= Math.max(1, config.reactivationPhaseMinSpins)
  if (ratio >= BALANCE_THRESHOLDS.recoveryRatio && spunOut) {
    return transition(state.phase, 'retention', 'recovered_to_70_percent')
  }
  if (ratio < BALANCE_THRESHOLDS.reactivationRatio && state.reactivationCount === 0) {
    return transition(state.phase, 'retention', 'fell_back_without_bonus')
  }
  return transition(state.phase, 'reactivation', 'reactivation_hold')
}

function holdPhase(ctx: GuardContext): PhaseTransition {
  return transition(ctx.state.phase, ctx.state.phase, 'terminal_phase_hold')
}

/**
 * §5.4 — эвристика определения фазы «с нуля» (для аналитики и симулятора,
 * когда состояния ещё нет). В рантайме спина не используется: там состояние
 * всегда есть, и фаза считается переходами §5.2.
 */
export function determinePhase(input: {
  totalSpins: number
  balanceRatio: number
  signals: PlayerBehaviorSignals
  config: EngagementConfig
}): EngagementPhase {
  const { totalSpins, balanceRatio, signals, config } = input
  if (totalSpins < config.onboardingSpinThreshold && balanceRatio < 1.2) {
    return 'onboarding'
  }
  if (
    balanceRatio < BALANCE_THRESHOLDS.riskRatio &&
    (signals.longPauseAfterLoss || signals.decreasingBetCount || hasChurnRisk(signals))
  ) {
    return 'risk'
  }
  return 'retention'
}

function transition(from: EngagementPhase, to: EngagementPhase, reason: string): PhaseTransition {
  return { phase: to, changed: to !== from, reason }
}

function isInactiveTooLong(state: EngagementState, now: number): boolean {
  const lastAt = state.lastSpinAt?.getTime()
  if (!lastAt) {
    return false
  }
  return now - lastAt > 30 * 60 * 1000
}
