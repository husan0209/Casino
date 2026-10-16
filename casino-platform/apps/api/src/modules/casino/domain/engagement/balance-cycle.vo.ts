/**
 * ТЗ ч.9 §4.1–§4.3 — цикл управления балансом.
 *
 * Это единственное место, где решается «сколько игрок должен иметь денег»:
 * отсюда берётся и цель ONBOARDING (§4.2 +20–30 % к базе), и коридор
 * реактивации (§4.3 возврат к 70–80 %). Фаза из состояния — вход, а не
 * результат: результат выдаёт FSM (§5.2) уже по этим правилам.
 */
import { Decimal } from 'decimal.js'

import type { MoneyAmount } from '@casino/shared-types'

import { BALANCE_THRESHOLDS } from './engagement-config'
import { balanceRatioOf } from './engagement-state.vo'

import type { EngagementPhase } from './engagement-phase'
import type { EngagementState } from './engagement-state.vo'

/** Шаг цикла из диаграммы §4.1 — попадает в логи и §11.2. */
export type CycleStep = 'pillar' | 'stable' | 'critical' | 'reactivation' | 'cooling' | 'inactive'

export interface BalanceCycle {
  /** Доля баланса от базы (MoneyAmount / initialDeposit). */
  readonly ratio: number
  /** Целевой баланс текущего шага (MoneyAmount). */
  readonly targetBalance: MoneyAmount
  readonly step: CycleStep
  /** §4.2 — цель «медового месяца»: +20–30 % к базе. */
  readonly onboardingTargetReached: boolean
  /** §4.3 — баланс ниже критической точки. */
  readonly atReactivationPoint: boolean
  /** §5.2 — «почти ушёл». */
  readonly nearZero: boolean
}

/** Цель ONBOARDING: +20 % (низ) … +30 % (выс) от базы. */
export function onboardingTargetBalance(state: EngagementState): MoneyAmount {
  const base = new Decimal(state.initialDeposit)
  return base.times(1.2).toFixed(8)
}

/**
 * §4.3 — коридор возврата: 70–80 % от базы. Случайная точка внутри коридора
 * выбирается вызывающим (use-case), здесь отдаются границы.
 */
export function reactivationTargetBalanceRange(
  state: EngagementState,
  config: { minRatio: number; maxRatio: number },
): { min: MoneyAmount; max: MoneyAmount } {
  const base = new Decimal(state.initialDeposit)
  return {
    min: base.times(config.minRatio).toFixed(8),
    max: base.times(config.maxRatio).toFixed(8),
  }
}

export function evaluateBalanceCycle(
  state: EngagementState,
  currentBalance: MoneyAmount,
  phase: EngagementPhase,
): BalanceCycle {
  const ratio = balanceRatioOf(state, currentBalance)
  const base = new Decimal(state.initialDeposit)
  const onboardingTarget = new Decimal(onboardingTargetBalance(state))

  const atReactivationPoint = ratio < BALANCE_THRESHOLDS.reactivationRatio
  const nearZero = ratio < BALANCE_THRESHOLDS.nearZeroRatio
  const onboardingTargetReached =
    new Decimal(currentBalance).gte(onboardingTarget) && onboardingTarget.gt(0)

  let step: CycleStep
  let targetBalance: MoneyAmount

  switch (phase) {
    case 'onboarding':
      step = 'pillar'
      targetBalance = onboardingTarget.toFixed(8)
      break
    case 'retention':
      step = 'stable'
      targetBalance = base.times(0.5).toFixed(8)
      break
    case 'risk':
      step = 'critical'
      targetBalance = base.times(BALANCE_THRESHOLDS.reactivationRatio).toFixed(8)
      break
    case 'reactivation':
      step = 'reactivation'
      targetBalance = base.times(BALANCE_THRESHOLDS.recoveryRatio).toFixed(8)
      break
    case 'cooldown':
      step = 'cooling'
      targetBalance = currentBalance
      break
    default:
      step = 'inactive'
      targetBalance = currentBalance
      break
  }

  return { ratio, targetBalance, step, onboardingTargetReached, atReactivationPoint, nearZero }
}
