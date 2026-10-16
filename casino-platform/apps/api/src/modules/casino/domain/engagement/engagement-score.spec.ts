import { describe, expect, it } from 'vitest'

import { calculateEngagementScoreFromSignals } from './engagement-score.vo'
import { applySpinToState, createEngagementState } from './engagement-state.vo'
import { computeBehaviorSignals } from './player-behavior.vo'

import type { EngagementState } from './engagement-state.vo'

const NOW = 1_700_000_000_000

function freshState(): EngagementState {
  return createEngagementState({
    userId: 'user-1',
    gameId: 'game-1',
    currency: 'RUB',
    initialDeposit: '1000',
    currentBalance: '1000',
  })
}

/** Состояние после n спинов: n подряд выигрышей или проигрышей. */
function afterSpins(state: EngagementState, n: number, isWin: boolean): EngagementState {
  let current = state
  for (let i = 0; i < n; i++) {
    current = applySpinToState({
      state: current,
      bet: '10',
      win: isWin ? '12' : '0',
      currentBalance: '1000',
      at: NOW - (n - i) * 5_000,
      isLdw: false,
      isNearMiss: false,
      nextPhase: 'onboarding',
      reactivationTriggered: false,
      targetRtpPercent: 107.5,
      sessionId: 'session-1',
    })
  }
  return current
}

describe('§6.1 Engagement Score', () => {
  it('держит Score в границах 0..100', () => {
    const state = freshState()
    const signals = computeBehaviorSignals(state, '1000', NOW)
    const score = calculateEngagementScoreFromSignals(state, signals)
    expect(score.value).toBeGreaterThanOrEqual(0)
    expect(score.value).toBeLessThanOrEqual(100)
    expect(score.base).toBe(50)
  })

  it('даёт базовые 50 новому игроку без истории', () => {
    const state = freshState()
    const signals = computeBehaviorSignals(state, '1000', NOW)
    expect(calculateEngagementScoreFromSignals(state, signals).value).toBe(50)
  })

  it('повышает Score за серию выигрышей (не выше +20)', () => {
    const state = afterSpins(freshState(), 8, true)
    const signals = computeBehaviorSignals(state, '1000', NOW)
    const score = calculateEngagementScoreFromSignals(state, signals)
    expect(score.winStreakBonus).toBe(20)
    expect(score.value).toBeGreaterThan(50)
  })

  it('штрафует за серию проигрышей (не ниже −30)', () => {
    const state = afterSpins(freshState(), 12, false)
    const signals = computeBehaviorSignals(state, '1000', NOW)
    const score = calculateEngagementScoreFromSignals(state, signals)
    expect(score.lossStreakPenalty).toBe(30)
    expect(score.value).toBeLessThan(50)
  })

  it('не обнуляет Score новичку: штраф ограничен активностью', () => {
    const state = afterSpins(freshState(), 3, false)
    const signals = computeBehaviorSignals(state, '1000', NOW)
    const score = calculateEngagementScoreFromSignals(state, signals)
    expect(score.churnRiskPenalty).toBeLessThanOrEqual(score.winStreakBonus + score.activityBonus)
    expect(score.value).toBeGreaterThan(0)
  })
})

describe('§6.2 поведенческие сигналы', () => {
  it('считает быстрые клики по частоте спинов', () => {
    const state = afterSpins(freshState(), 12, true)
    const signals = computeBehaviorSignals(state, '1000', NOW)
    expect(signals.rapidClicking).toBe(true)
    expect(signals.avgTimeBetweenSpins).toBeLessThan(15_000)
  })

  it('видит паузу после проигрыша', () => {
    let state = freshState()
    state = applySpinToState({
      state,
      bet: '10',
      win: '0',
      currentBalance: '990',
      at: NOW - 45_000,
      isLdw: false,
      isNearMiss: false,
      nextPhase: 'onboarding',
      reactivationTriggered: false,
      targetRtpPercent: 107.5,
      sessionId: 'session-1',
    })
    const signals = computeBehaviorSignals(state, '1000', NOW)
    expect(signals.longPauseAfterLoss).toBe(true)
  })

  it('не считает паузой время снаружи окна активности', () => {
    const state = afterSpins(freshState(), 3, false)
    // now заметно позже последнего спина — но «окно» живёт от последнего спина,
    // иначе бэкенд штрафовал бы игрока за перерыв.
    const signals = computeBehaviorSignals(state, '1000', NOW + 3_600_000)
    expect(signals.longPauseAfterLoss).toBe(false)
  })

  it('помечает баланс около нуля', () => {
    const state = freshState()
    expect(computeBehaviorSignals(state, '50', NOW).balanceNearZero).toBe(true)
    expect(computeBehaviorSignals(state, '500', NOW).balanceNearZero).toBe(false)
  })

  it('средняя ставка — MoneyAmount-строка', () => {
    const state = afterSpins(freshState(), 4, true)
    const signals = computeBehaviorSignals(state, '1000', NOW)
    expect(signals.avgBetSize).toBe('10.00000000')
  })
})
