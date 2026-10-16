import { describe, expect, it } from 'vitest'

import { CHURN_RISK_PENALTIES, SCORE_WEIGHTS } from '../src/config'
import { type EngagementState, type PlayerBehaviorSignals } from '../src/domain/types'
import { calculateEngagementScore } from '../src/engine/engagement-score'
import { createInitialState } from '../src/engine/state-transitions'

/**
 * Числа в ожиданиях зафиксированы буквально (§6.1 + кап из §1.4) и сверены
 * с экспортами src/config.ts отдельными assertions — если конфиг уедет,
 * тесты упадут и на числах, и на сверке.
 */

function makeState(overrides: Partial<EngagementState> = {}): EngagementState {
  const base = createInitialState({
    userId: 'player-1',
    gameId: 'fortunetiger',
    sessionId: 'session-1',
    initialDeposit: '1000',
    startedAt: new Date(0),
  })
  return { ...base, ...overrides }
}

function makeSignals(overrides: Partial<PlayerBehaviorSignals> = {}): PlayerBehaviorSignals {
  return {
    avgTimeBetweenSpins: 2_000,
    spinsInLastMinute: 0,
    spinsInLast5Minutes: 0,
    avgBetSize: '5',
    betTrend: 'stable',
    balanceRatio: 1,
    winLossRatio: 0,
    lastWinAmount: '0',
    maxWinInSession: '0',
    decreasingBetCount: false,
    longPauseAfterLoss: false,
    balanceNearZero: false,
    rapidClicking: false,
    slowClicking: false,
    ...overrides,
  }
}

describe('§6.1 calculateEngagementScore', () => {
  it('веса и капены в конфиге соответствуют формуле ТЗ', () => {
    expect(SCORE_WEIGHTS.base).toBe(50)
    expect(SCORE_WEIGHTS.winStreakStep).toBe(5)
    expect(SCORE_WEIGHTS.winStreakCap).toBe(20)
    expect(SCORE_WEIGHTS.lossStreakStep).toBe(4)
    expect(SCORE_WEIGHTS.lossStreakCap).toBe(30)
    expect(SCORE_WEIGHTS.activityStep).toBe(0.5)
    expect(SCORE_WEIGHTS.activityCap).toBe(15)
    expect(SCORE_WEIGHTS.churnPenaltyCap).toBe(25)
  })

  it('пустое состояние даёт ровно baseScore 50', () => {
    expect(calculateEngagementScore(makeState(), makeSignals())).toBe(50)
  })

  it('winStreakBonus: 5 подряд capped ровно в +20, 4 подряд ещё 20 без капа', () => {
    const fiveWins = makeState({ consecutiveWins: 5 })
    // min(5 * 5, 20) = 20: 25 срезано капом.
    expect(calculateEngagementScore(fiveWins, makeSignals())).toBe(70)
    const nineWins = makeState({ consecutiveWins: 9 })
    // min(9 * 5, 20) = 20: кап не растёт дальше 5 спинов.
    expect(calculateEngagementScore(nineWins, makeSignals())).toBe(70)
    const fourWins = makeState({ consecutiveWins: 4 })
    // 4 * 5 = 20 — до капа включительно.
    expect(calculateEngagementScore(fourWins, makeSignals())).toBe(70)
    const threeWins = makeState({ consecutiveWins: 3 })
    expect(calculateEngagementScore(threeWins, makeSignals())).toBe(65)
  })

  it('lossStreakPenalty: 8 подряд capped ровно в 30 (50 - 30 = 20)', () => {
    const eightLosses = makeState({ consecutiveLosses: 8 })
    // min(8 * 4, 30) = 30: 32 срезано капом.
    expect(calculateEngagementScore(eightLosses, makeSignals())).toBe(20)
    const sevenLosses = makeState({ consecutiveLosses: 7 })
    // 7 * 4 = 28 — до капа.
    expect(calculateEngagementScore(sevenLosses, makeSignals())).toBe(22)
  })

  it('activityBonus: 30 спинов за 5 минут capped ровно в +15', () => {
    // min(30 * 0.5, 15) = 15: 31 спин тоже даст 15.
    expect(calculateEngagementScore(makeState(), makeSignals({ spinsInLast5Minutes: 30 }))).toBe(65)
    expect(calculateEngagementScore(makeState(), makeSignals({ spinsInLast5Minutes: 31 }))).toBe(65)
    expect(calculateEngagementScore(makeState(), makeSignals({ spinsInLast5Minutes: 10 }))).toBe(55)
  })

  it('churnRiskPenalty: сумма весов сработавших признаков, кап 25', () => {
    // ТЗ дал только диапазон 0–25; веса — CHURN_RISK_PENALTIES (lab default).
    expect(CHURN_RISK_PENALTIES.slowClicking).toBe(8)
    expect(CHURN_RISK_PENALTIES.decreasingBetCount).toBe(6)
    expect(CHURN_RISK_PENALTIES.longPauseAfterLoss).toBe(5)
    expect(CHURN_RISK_PENALTIES.balanceNearZero).toBe(6)

    const twoFlags = makeSignals({ slowClicking: true, balanceNearZero: true })
    // 50 - (8 + 6) = 36.
    expect(calculateEngagementScore(makeState(), twoFlags)).toBe(36)

    const allFlags = makeSignals({
      slowClicking: true,
      decreasingBetCount: true,
      longPauseAfterLoss: true,
      balanceNearZero: true,
    })
    // 8 + 6 + 5 + 6 = 25 — ровно кап; 50 - 25 = 25.
    expect(calculateEngagementScore(makeState(), allFlags)).toBe(25)
  })

  it('итог зажат снизу 0: 9 проигрышей подряд + полный churn-букет не уходят в минус', () => {
    const doomed = makeState({ consecutiveLosses: 9 })
    const churn = makeSignals({
      slowClicking: true,
      decreasingBetCount: true,
      longPauseAfterLoss: true,
      balanceNearZero: true,
    })
    // 50 - min(9 * 4, 30) - 25 = -5 -> клампится в 0.
    expect(calculateEngagementScore(doomed, churn)).toBe(0)
  })

  it('итог зажат сверху 100: максимум формулы (50 + 20 + 15) = 85 в допуске', () => {
    const lucky = makeState({ consecutiveWins: 40 })
    const busy = makeSignals({ spinsInLast5Minutes: 99 })
    // 50 + 20 + 15 = 85: ниже потолка 100, кламп не срабатывает, но рамка обязана держаться.
    const score = calculateEngagementScore(lucky, busy)
    expect(score).toBe(85)
    expect(score).toBeLessThanOrEqual(100)
  })

  it('§1.4: результат — целое: 7 спинов за 5 минут (0.5 * 7 = 3.5) округляются вниз', () => {
    const fractional = makeSignals({ spinsInLast5Minutes: 7 })
    const score = calculateEngagementScore(makeState(), fractional)
    // 50 + 3.5 = 53.5 -> floor -> 53.
    expect(score).toBe(53)
    expect(Number.isInteger(score)).toBe(true)
  })

  it('дробная часть уходит вниз и при отрицательном сыром итоге', () => {
    const state = makeState({ consecutiveLosses: 6 })
    const signals = makeSignals({ spinsInLast5Minutes: 3, slowClicking: true })
    // 50 - 24 + 1.5 - 8 = 19.5 -> floor -> 19.
    expect(calculateEngagementScore(state, signals)).toBe(19)
  })
})
