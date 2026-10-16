import { describe, expect, it } from 'vitest'

import { BEHAVIOR, TIMING } from '../src/config'
import { computeBehaviorSignals } from '../src/domain/behavior-signals'
import {
  type EngagementCounters,
  type EngagementState,
  type MoneyAmount,
  type PlayerBehaviorSignals,
} from '../src/domain/types'
import { createInitialState } from '../src/engine/state-transitions'

const NOW_MS = 10_000_000

function makeState(args: {
  initialDeposit?: MoneyAmount
  currentBalance?: MoneyAmount
  spinTimestamps?: number[]
  betAmounts?: MoneyAmount[]
  totalWins?: number
  totalLosses?: number
  counters?: Partial<EngagementCounters>
}): EngagementState {
  const base = createInitialState({
    userId: 'player-1',
    gameId: 'fortunetiger',
    sessionId: 'session-1',
    initialDeposit: args.initialDeposit ?? '1000',
    startedAt: new Date(0),
  })
  const counters: EngagementCounters = { ...base.counters, ...(args.counters ?? {}) }
  return {
    ...base,
    spinTimestamps: args.spinTimestamps ?? [],
    betAmounts: args.betAmounts ?? [],
    currentBalance: args.currentBalance ?? base.currentBalance,
    totalSpins: (args.spinTimestamps ?? []).length,
    totalWins: args.totalWins ?? 0,
    totalLosses: args.totalLosses ?? 0,
    counters,
  }
}

/** n меток, начиная с firstMs, с шагом stepMs. */
function buildTimestamps(count: number, firstMs: number, stepMs: number): number[] {
  const marks: number[] = []
  for (let index = 0; index < count; index++) {
    marks.push(firstMs + index * stepMs)
  }
  return marks
}

/** leadingCount ставок по leadingValue, затем trailingCount ставок по trailingValue. */
function buildBets(
  leadingValue: MoneyAmount,
  leadingCount: number,
  trailingValue: MoneyAmount,
  trailingCount: number,
): MoneyAmount[] {
  const bets: MoneyAmount[] = []
  for (let index = 0; index < leadingCount; index++) {
    bets.push(leadingValue)
  }
  for (let index = 0; index < trailingCount; index++) {
    bets.push(trailingValue)
  }
  return bets
}

function finiteNumbers(signals: PlayerBehaviorSignals): number[] {
  return [
    signals.avgTimeBetweenSpins,
    signals.spinsInLastMinute,
    signals.spinsInLast5Minutes,
    signals.balanceRatio,
    signals.winLossRatio,
  ]
}

describe('§6.2 computeBehaviorSignals', () => {
  it('пустое состояние (0 спинов) не даёт ни NaN, ни Infinity', () => {
    const signals = computeBehaviorSignals(makeState({}), NOW_MS)

    expect(signals.avgTimeBetweenSpins).toBe(0)
    expect(signals.spinsInLastMinute).toBe(0)
    expect(signals.spinsInLast5Minutes).toBe(0)
    expect(signals.winLossRatio).toBe(0)
    expect(signals.betTrend).toBe('stable')
    expect(signals.balanceRatio).toBe(1)
    expect(signals.rapidClicking).toBe(false)
    // 0 спинов — это не «потеря интереса», а ещё не начавшаяся сессия.
    expect(signals.slowClicking).toBe(false)
    expect(signals.decreasingBetCount).toBe(false)
    expect(signals.longPauseAfterLoss).toBe(false)
    expect(signals.balanceNearZero).toBe(false)
    expect(signals.avgBetSize).toBe('0')
    for (const value of finiteNumbers(signals)) {
      expect(Number.isFinite(value)).toBe(true)
    }
  })

  it('winLossRatio при 0 спинов равен 0, а не NaN', () => {
    const signals = computeBehaviorSignals(makeState({ totalWins: 0, totalLosses: 0 }), NOW_MS)
    expect(signals.winLossRatio).toBe(0)
  })

  it('winLossRatio = wins / (wins + losses)', () => {
    const signals = computeBehaviorSignals(makeState({ totalWins: 3, totalLosses: 7 }), NOW_MS)
    expect(signals.winLossRatio).toBeCloseTo(0.3, 10)
  })

  it('ровно 1 спин: нет среднего интервала и нет деления на ноль', () => {
    const state = makeState({
      spinTimestamps: [NOW_MS - 1_000],
      betAmounts: ['5'],
      totalWins: 1,
      totalLosses: 0,
    })
    const signals = computeBehaviorSignals(state, NOW_MS)

    expect(signals.avgTimeBetweenSpins).toBe(0)
    expect(signals.spinsInLastMinute).toBe(1)
    expect(signals.spinsInLast5Minutes).toBe(1)
    expect(signals.avgBetSize).toBe('5')
    expect(signals.betTrend).toBe('stable')
    expect(signals.winLossRatio).toBe(1)
    for (const value of finiteNumbers(signals)) {
      expect(Number.isFinite(value)).toBe(true)
    }
  })

  it('rapid clicking: больше BEHAVIOR.rapidClicksPerMinute спинов за минуту', () => {
    const state = makeState({
      spinTimestamps: buildTimestamps(11, NOW_MS - 59_000, 1_000),
      betAmounts: buildBets('5', 11, '5', 0),
    })
    const signals = computeBehaviorSignals(state, NOW_MS)

    expect(signals.spinsInLastMinute).toBe(11)
    expect(signals.rapidClicking).toBe(true)
    // Всплеск быстрых кликов не должен одновременно читаться как «потеря интереса».
    expect(signals.slowClicking).toBe(false)
  })

  it('на границе порога rapid clicking не срабатывает (ровно 10/мин)', () => {
    const state = makeState({
      spinTimestamps: buildTimestamps(BEHAVIOR.rapidClicksPerMinute, NOW_MS - 59_000, 1_000),
    })
    const signals = computeBehaviorSignals(state, NOW_MS)
    expect(signals.spinsInLastMinute).toBe(BEHAVIOR.rapidClicksPerMinute)
    expect(signals.rapidClicking).toBe(false)
  })

  it('slow clicking: меньше BEHAVIOR.slowClicksPerMinute в пересчёте на 5 минут', () => {
    const state = makeState({ spinTimestamps: [NOW_MS - 150_000, NOW_MS - 30_000] })
    const signals = computeBehaviorSignals(state, NOW_MS)

    expect(signals.spinsInLastMinute).toBe(1)
    expect(signals.spinsInLast5Minutes).toBe(2)
    expect(signals.slowClicking).toBe(true)
    expect(signals.rapidClicking).toBe(false)
    expect(signals.avgTimeBetweenSpins).toBe(120_000)
  })

  it('долгая пауза после проигрыша: lastOutcomeWasLoss + последний спин дальше TIMING.longPauseAfterLossMs', () => {
    const state = makeState({
      spinTimestamps: [NOW_MS - TIMING.longPauseAfterLossMs - 10_000],
      counters: { lastOutcomeWasLoss: true },
    })
    const signals = computeBehaviorSignals(state, NOW_MS)
    expect(signals.longPauseAfterLoss).toBe(true)
  })

  it('пауза меньше порога не считается долгой', () => {
    const state = makeState({
      spinTimestamps: [NOW_MS - 10_000],
      counters: { lastOutcomeWasLoss: true },
    })
    const signals = computeBehaviorSignals(state, NOW_MS)
    expect(signals.longPauseAfterLoss).toBe(false)
  })

  it('долгая пауза без предшествующего проигрыша не сигналит уход', () => {
    const state = makeState({
      spinTimestamps: [NOW_MS - TIMING.longPauseAfterLossMs - 10_000],
      counters: { lastOutcomeWasLoss: false },
    })
    const signals = computeBehaviorSignals(state, NOW_MS)
    expect(signals.longPauseAfterLoss).toBe(false)
  })

  it('betTrend increasing: последние ставки выше средних на порог 1.15', () => {
    const state = makeState({ betAmounts: buildBets('10', 10, '20', 10) })
    const signals = computeBehaviorSignals(state, NOW_MS)

    // среднее по сессии (100+200)/20 = 15, последнее окно = 20 > 15*1.15.
    expect(signals.betTrend).toBe('increasing')
    expect(signals.avgBetSize).toBe('15')
  })

  it('betTrend decreasing: последние ставки ниже средних на порог 0.85', () => {
    const state = makeState({ betAmounts: buildBets('10', 10, '5', 10) })
    const signals = computeBehaviorSignals(state, NOW_MS)

    // среднее (100+50)/20 = 7.5, последнее окно = 5 < 7.5*0.85.
    expect(signals.betTrend).toBe('decreasing')
    expect(signals.avgBetSize).toBe('7.5')
  })

  it('betTrend stable: ставки не уходят за пороги', () => {
    const state = makeState({ betAmounts: buildBets('10', 20, '10', 0) })
    const signals = computeBehaviorSignals(state, NOW_MS)
    expect(signals.betTrend).toBe('stable')
    expect(signals.avgBetSize).toBe('10')
    expect(signals.decreasingBetCount).toBe(false)
  })

  it('decreasingBetCount: ставка падает И интервал между спинами растёт', () => {
    const previousMarks = buildTimestamps(10, 0, 2_000)
    const recentMarks = buildTimestamps(10, 26_000, 8_000)
    const state = makeState({
      spinTimestamps: [...previousMarks, ...recentMarks],
      betAmounts: buildBets('10', 10, '5', 10),
    })
    const signals = computeBehaviorSignals(state, NOW_MS)

    expect(signals.betTrend).toBe('decreasing')
    expect(signals.avgTimeBetweenSpins).toBe(8_000)
    expect(signals.decreasingBetCount).toBe(true)
  })

  it('decreasingBetCount ложен, если активность не падает', () => {
    const previousMarks = buildTimestamps(10, 0, 8_000)
    const recentMarks = buildTimestamps(10, 74_000, 2_000)
    const state = makeState({
      spinTimestamps: [...previousMarks, ...recentMarks],
      betAmounts: buildBets('10', 10, '5', 10),
    })
    const signals = computeBehaviorSignals(state, NOW_MS)

    expect(signals.betTrend).toBe('decreasing')
    expect(signals.decreasingBetCount).toBe(false)
  })

  it('decreasingBetCount ложен, пока нет предыдущего окна для сравнения', () => {
    const state = makeState({
      spinTimestamps: buildTimestamps(5, NOW_MS - 50_000, 10_000),
      betAmounts: buildBets('10', 10, '5', 10),
    })
    const signals = computeBehaviorSignals(state, NOW_MS)
    expect(signals.betTrend).toBe('decreasing')
    expect(signals.decreasingBetCount).toBe(false)
  })

  it('нулевой initialDeposit: balanceRatio 0 и никаких NaN/Infinity', () => {
    const state = makeState({
      initialDeposit: '0',
      currentBalance: '0',
      betAmounts: ['5'],
    })
    const signals = computeBehaviorSignals(state, NOW_MS)

    expect(signals.balanceRatio).toBe(0)
    expect(signals.balanceNearZero).toBe(false)
    for (const value of finiteNumbers(signals)) {
      expect(Number.isFinite(value)).toBe(true)
    }
  })

  it('balanceRatio и balanceNearZero: 5 % депозита ниже порога 10 %', () => {
    const state = makeState({ initialDeposit: '1000', currentBalance: '50' })
    const signals = computeBehaviorSignals(state, NOW_MS)

    expect(signals.balanceRatio).toBeCloseTo(0.05, 10)
    expect(signals.balanceNearZero).toBe(true)
  })

  it('balanceNearZero ложен при балансе ровно на пороге (строгое «<»)', () => {
    const state = makeState({ initialDeposit: '1000', currentBalance: '100' })
    const signals = computeBehaviorSignals(state, NOW_MS)
    expect(signals.balanceNearZero).toBe(false)
  })

  it('окна частоты считаются относительно nowMs, а не Date.now()', () => {
    const oldSpin = NOW_MS - TIMING.fiveMinutesMs - 1
    const state = makeState({ spinTimestamps: [oldSpin] })
    const signals = computeBehaviorSignals(state, NOW_MS)

    expect(signals.spinsInLastMinute).toBe(0)
    expect(signals.spinsInLast5Minutes).toBe(0)
    expect(signals.slowClicking).toBe(false)
  })

  it('сигналы уходят прямо в adaptive-RTP: lastWinAmount и maxWinInSession из counters', () => {
    const state = makeState({
      counters: { lastWinAmount: '12.5', maxWinInSession: '250' },
    })
    const signals = computeBehaviorSignals(state, NOW_MS)

    expect(signals.lastWinAmount).toBe('12.5')
    expect(signals.maxWinInSession).toBe('250')
  })
})
