import { describe, expect, it } from 'vitest'

import { BALANCE_CYCLE, TIMING } from '../src/config'
import { EngagementPhase } from '../src/domain/engagement-phase'
import {
  type EngagementCounters,
  type EngagementState,
  type PlayerBehaviorSignals,
} from '../src/domain/types'
import { determinePhase, nextPhaseByGuards } from '../src/engine/phase-fsm'
import { createInitialState } from '../src/engine/state-transitions'

type StateOverrides = Partial<Omit<EngagementState, 'counters'>> & {
  counters?: Partial<EngagementCounters>
}

const NOW = new Date(1_700_000_000_000)

function makeState(overrides: StateOverrides = {}): EngagementState {
  const base = createInitialState({
    userId: 'player-1',
    gameId: 'fortunetiger',
    sessionId: 'session-1',
    initialDeposit: '1000',
    startedAt: NOW,
  })
  return {
    ...base,
    ...overrides,
    counters: { ...base.counters, ...overrides.counters },
  }
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

/** now минус ровно dormantAfterMs — граница «30 минут» строгая (>). */
function inactiveSince(ms: number): EngagementState {
  return makeState({ lastActivityAt: new Date(NOW.getTime() - ms) })
}

describe('§5.4 determinePhase (эвристика)', () => {
  it('ONBOARDING, пока спинов < 15 И подушка < 1.2', () => {
    const early = makeState({ totalSpins: BALANCE_CYCLE.onboardingSpinThreshold - 1 })
    expect(determinePhase(early, makeSignals({ balanceRatio: 1.19 }))).toBe(
      EngagementPhase.ONBOARDING,
    )
    // Ровно 15 спинов — ONBOARDING уже невозможен.
    const atThreshold = makeState({ totalSpins: BALANCE_CYCLE.onboardingSpinThreshold })
    expect(determinePhase(atThreshold, makeSignals({ balanceRatio: 1.19 }))).toBe(
      EngagementPhase.RETENTION,
    )
    // Ровно pillowRatioMin = 1.2 — условие «< 1.2» не выполнено.
    const atPillow = makeState({ totalSpins: 5 })
    expect(determinePhase(atPillow, makeSignals({ balanceRatio: 1.2 }))).toBe(
      EngagementPhase.RETENTION,
    )
  })

  it('REACTIVATION по counters.reactivationTriggered, пока spinsSinceReactivation < 3', () => {
    const fresh = makeState({
      totalSpins: 40,
      counters: { reactivationTriggered: true, spinsSinceReactivation: 2 },
    })
    expect(determinePhase(fresh, makeSignals({ balanceRatio: 0.9 }))).toBe(
      EngagementPhase.REACTIVATION,
    )
    const spent = makeState({
      totalSpins: 40,
      counters: { reactivationTriggered: true, spinsSinceReactivation: 3 },
    })
    expect(determinePhase(spent, makeSignals({ balanceRatio: 0.9 }))).toBe(
      EngagementPhase.RETENTION,
    )
  })

  it('RISK: баланс < 0.5 И признак ухода; ровно 0.5 — не RISK', () => {
    const state = makeState({ totalSpins: 40 })
    expect(
      determinePhase(state, makeSignals({ balanceRatio: 0.49, longPauseAfterLoss: true })),
    ).toBe(EngagementPhase.RISK)
    expect(
      determinePhase(state, makeSignals({ balanceRatio: 0.4, decreasingBetCount: true })),
    ).toBe(EngagementPhase.RISK)
    // avgTimeBetweenSpins > 15 сек (строго): 15 001 мс — RISK, 15 000 мс — нет.
    expect(
      determinePhase(state, makeSignals({ balanceRatio: 0.4, avgTimeBetweenSpins: 15_001 })),
    ).toBe(EngagementPhase.RISK)
    expect(
      determinePhase(state, makeSignals({ balanceRatio: 0.4, avgTimeBetweenSpins: 15_000 })),
    ).toBe(EngagementPhase.RETENTION)
    expect(
      determinePhase(state, makeSignals({ balanceRatio: 0.5, longPauseAfterLoss: true })),
    ).toBe(EngagementPhase.RETENTION)
    // Баланс низкий, признаков ухода нет — RETENTION.
    expect(determinePhase(state, makeSignals({ balanceRatio: 0.3 }))).toBe(
      EngagementPhase.RETENTION,
    )
  })

  it('по умолчанию RETENTION', () => {
    const healthy = makeState({ totalSpins: 40 })
    expect(determinePhase(healthy, makeSignals({ balanceRatio: 0.9 }))).toBe(
      EngagementPhase.RETENTION,
    )
  })
})

describe('§5.2 nextPhaseByGuards (FSM)', () => {
  it('ONBOARDING→RETENTION: totalSpins ровно 15 ИЛИ balanceRatio ровно 1.25', () => {
    const spinsBoundary = makeState({
      engagementPhase: EngagementPhase.ONBOARDING,
      totalSpins: 15,
    })
    expect(nextPhaseByGuards(spinsBoundary, makeSignals({ balanceRatio: 1.0 }), NOW)).toBe(
      EngagementPhase.RETENTION,
    )
    const ratioBoundary = makeState({
      engagementPhase: EngagementPhase.ONBOARDING,
      totalSpins: 3,
    })
    expect(nextPhaseByGuards(ratioBoundary, makeSignals({ balanceRatio: 1.25 }), NOW)).toBe(
      EngagementPhase.RETENTION,
    )
    // Не хватило обоих условий — остаёмся в ONBOARDING (обратная сторона).
    const stay = makeState({ engagementPhase: EngagementPhase.ONBOARDING, totalSpins: 14 })
    expect(nextPhaseByGuards(stay, makeSignals({ balanceRatio: 1.24 }), NOW)).toBe(
      EngagementPhase.ONBOARDING,
    )
  })

  it('RETENTION→RISK: balanceRatio < 0.5 AND (slowClicking OR consecutiveLosses >= 5)', () => {
    const slow = makeState({ engagementPhase: EngagementPhase.RETENTION })
    expect(
      nextPhaseByGuards(slow, makeSignals({ balanceRatio: 0.49, slowClicking: true }), NOW),
    ).toBe(EngagementPhase.RISK)
    const streak = makeState({
      engagementPhase: EngagementPhase.RETENTION,
      consecutiveLosses: 5,
    })
    expect(nextPhaseByGuards(streak, makeSignals({ balanceRatio: 0.4 }), NOW)).toBe(
      EngagementPhase.RISK,
    )
    // Обратная сторона: ровно 0.5 — не «< 0.5».
    const atHalf = makeState({ engagementPhase: EngagementPhase.RETENTION })
    expect(
      nextPhaseByGuards(atHalf, makeSignals({ balanceRatio: 0.5, slowClicking: true }), NOW),
    ).toBe(EngagementPhase.RETENTION)
    // 4 проигрыша — мало, и slowClicking нет.
    const fourLosses = makeState({
      engagementPhase: EngagementPhase.RETENTION,
      consecutiveLosses: 4,
    })
    expect(nextPhaseByGuards(fourLosses, makeSignals({ balanceRatio: 0.4 }), NOW)).toBe(
      EngagementPhase.RETENTION,
    )
    // Баланс низкий, но ни одного признака — остаёмся в RETENTION.
    const quiet = makeState({ engagementPhase: EngagementPhase.RETENTION })
    expect(nextPhaseByGuards(quiet, makeSignals({ balanceRatio: 0.3 }), NOW)).toBe(
      EngagementPhase.RETENTION,
    )
  })

  it('RISK→REACTIVATION: balanceRatio < 0.2 AND reactivationCount < 4', () => {
    const atPoint = makeState({
      engagementPhase: EngagementPhase.RISK,
      reactivationCount: 3,
    })
    expect(nextPhaseByGuards(atPoint, makeSignals({ balanceRatio: 0.19 }), NOW)).toBe(
      EngagementPhase.REACTIVATION,
    )
    // Ровно 0.2 — не «< 0.2» (обратная сторона).
    const atThreshold = makeState({ engagementPhase: EngagementPhase.RISK })
    expect(nextPhaseByGuards(atThreshold, makeSignals({ balanceRatio: 0.2 }), NOW)).toBe(
      EngagementPhase.RISK,
    )
    // Ровно maxReactivations = 4 — реактиваций не осталось (обратная сторона).
    const exhausted = makeState({
      engagementPhase: EngagementPhase.RISK,
      reactivationCount: 4,
    })
    expect(nextPhaseByGuards(exhausted, makeSignals({ balanceRatio: 0.1 }), NOW)).toBe(
      EngagementPhase.RISK,
    )
    // В RISK guard RETENTION-перехода нет: высокий баланс не выводит из RISK.
    const recovered = makeState({ engagementPhase: EngagementPhase.RISK })
    expect(nextPhaseByGuards(recovered, makeSignals({ balanceRatio: 0.8 }), NOW)).toBe(
      EngagementPhase.RISK,
    )
  })

  it('REACTIVATION→RETENTION: balanceRatio >= 0.7 AND spinsSinceReactivation >= 3', () => {
    const recovered = makeState({
      engagementPhase: EngagementPhase.REACTIVATION,
      reactivationCount: 2,
      counters: { spinsSinceReactivation: 3 },
    })
    expect(nextPhaseByGuards(recovered, makeSignals({ balanceRatio: 0.7 }), NOW)).toBe(
      EngagementPhase.RETENTION,
    )
    // Обратная сторона: баланс 0.69 — мало.
    const weak = makeState({
      engagementPhase: EngagementPhase.REACTIVATION,
      reactivationCount: 2,
      counters: { spinsSinceReactivation: 3 },
    })
    expect(nextPhaseByGuards(weak, makeSignals({ balanceRatio: 0.69 }), NOW)).toBe(
      EngagementPhase.REACTIVATION,
    )
    // Обратная сторона: 2 спина после реактивации — рано.
    const early = makeState({
      engagementPhase: EngagementPhase.REACTIVATION,
      reactivationCount: 2,
      counters: { spinsSinceReactivation: 2 },
    })
    expect(nextPhaseByGuards(early, makeSignals({ balanceRatio: 0.75 }), NOW)).toBe(
      EngagementPhase.REACTIVATION,
    )
  })

  it('REACTIVATION→COOLDOWN: reactivationCount ровно 4 = MAX', () => {
    const atMax = makeState({
      engagementPhase: EngagementPhase.REACTIVATION,
      reactivationCount: 4,
    })
    expect(nextPhaseByGuards(atMax, makeSignals({ balanceRatio: 0.1 }), NOW)).toBe(
      EngagementPhase.COOLDOWN,
    )
    // Обратная сторона: 3 реактивации — не COOLDOWN.
    const belowMax = makeState({
      engagementPhase: EngagementPhase.REACTIVATION,
      reactivationCount: 3,
      counters: { spinsSinceReactivation: 1 },
    })
    expect(nextPhaseByGuards(belowMax, makeSignals({ balanceRatio: 0.5 }), NOW)).toBe(
      EngagementPhase.REACTIVATION,
    )
    // Оба guard'а истинны одновременно: ТЗ не задало приоритет — COOLDOWN
    // выигрывает (§5.1 «входит после достижения максимума реактиваций»).
    const bothGuards = makeState({
      engagementPhase: EngagementPhase.REACTIVATION,
      reactivationCount: 4,
      counters: { spinsSinceReactivation: 5 },
    })
    expect(nextPhaseByGuards(bothGuards, makeSignals({ balanceRatio: 0.75 }), NOW)).toBe(
      EngagementPhase.COOLDOWN,
    )
  })

  it('COOLDOWN терминальна: без неактивности только COOLDOWN, что бы ни показывал баланс', () => {
    const cooling = makeState({
      engagementPhase: EngagementPhase.COOLDOWN,
      reactivationCount: 4,
    })
    expect(
      nextPhaseByGuards(cooling, makeSignals({ balanceRatio: 0.1, slowClicking: true }), NOW),
    ).toBe(EngagementPhase.COOLDOWN)
  })

  it('*→DORMANT: ровно 30 минут — ещё нет, 30 минут + 1 мс — да (§5.1, строгое >)', () => {
    const exactlyThirtyMinutes = inactiveSince(TIMING.dormantAfterMs)
    expect(
      nextPhaseByGuards(
        { ...exactlyThirtyMinutes, engagementPhase: EngagementPhase.RETENTION },
        makeSignals({ balanceRatio: 0.9 }),
        NOW,
      ),
    ).toBe(EngagementPhase.RETENTION)

    const thirtyPlusOneMs = inactiveSince(TIMING.dormantAfterMs + 1)
    expect(
      nextPhaseByGuards(
        { ...thirtyPlusOneMs, engagementPhase: EngagementPhase.RETENTION },
        makeSignals({ balanceRatio: 0.9 }),
        NOW,
      ),
    ).toBe(EngagementPhase.DORMANT)

    // COOLDOWN→DORMANT — единственный выход из COOLDOWN.
    const coolingDormant = inactiveSince(TIMING.dormantAfterMs + 1)
    expect(
      nextPhaseByGuards(
        { ...coolingDormant, engagementPhase: EngagementPhase.COOLDOWN },
        makeSignals({ balanceRatio: 0.9 }),
        NOW,
      ),
    ).toBe(EngagementPhase.DORMANT)
    // Ровно 30 минут из COOLDOWN — остаётся в COOLDOWN.
    const coolingHeld = inactiveSince(TIMING.dormantAfterMs)
    expect(
      nextPhaseByGuards(
        { ...coolingHeld, engagementPhase: EngagementPhase.COOLDOWN },
        makeSignals({ balanceRatio: 0.9 }),
        NOW,
      ),
    ).toBe(EngagementPhase.COOLDOWN)
  })

  it('DORMANT поглощает: исходящих переходов в таблице нет, механики не применяются', () => {
    const dormant = makeState({ engagementPhase: EngagementPhase.DORMANT, totalSpins: 40 })
    expect(
      nextPhaseByGuards(
        dormant,
        makeSignals({ balanceRatio: 0.1, slowClicking: true, longPauseAfterLoss: true }),
        NOW,
      ),
    ).toBe(EngagementPhase.DORMANT)
  })
})

describe('§5.4 против §5.2: расхождения на одном входе', () => {
  it('конвергенция: balanceRatio 0.3 со slowClicking (паузы 20 с) — обе дают RISK', () => {
    const state = makeState({ engagementPhase: EngagementPhase.RETENTION, totalSpins: 40 })
    const signals = makeSignals({
      balanceRatio: 0.3,
      slowClicking: true,
      avgTimeBetweenSpins: 20_000,
    })
    expect(nextPhaseByGuards(state, signals, NOW)).toBe(EngagementPhase.RISK)
    expect(determinePhase(state, signals)).toBe(EngagementPhase.RISK)
  })

  it('РАСХОЖДЕНИЕ (зафиксировано): consecutiveLosses = 6 без slowClicking — FSM даёт RISK, эвристика RETENTION', () => {
    // §5.2 принимает серии проигрышей, §5.4 — нет: признаки ухода там
    // ограничены longPauseAfterLoss / decreasingBetCount / avgTime > 15 с.
    const state = makeState({
      engagementPhase: EngagementPhase.RETENTION,
      totalSpins: 40,
      consecutiveLosses: 6,
    })
    const signals = makeSignals({ balanceRatio: 0.4 })
    expect(nextPhaseByGuards(state, signals, NOW)).toBe(EngagementPhase.RISK)
    expect(determinePhase(state, signals)).toBe(EngagementPhase.RETENTION)
  })

  it('РАСХОЖДЕНИЕ: REACTIVATION — FSM смотрит на баланс/счётчик, эвристика на counters.reactivationTriggered', () => {
    const state = makeState({
      engagementPhase: EngagementPhase.RISK,
      totalSpins: 40,
      reactivationCount: 1,
      counters: { reactivationTriggered: false, spinsSinceReactivation: 9 },
    })
    const signals = makeSignals({ balanceRatio: 0.1, longPauseAfterLoss: true })
    expect(nextPhaseByGuards(state, signals, NOW)).toBe(EngagementPhase.REACTIVATION)
    expect(determinePhase(state, signals)).toBe(EngagementPhase.RISK)
  })

  it('РАСХОЖДЕНИЕ: 10 спинов, balanceRatio 1.22 — FSM держит ONBOARDING, эвристика уже в RETENTION', () => {
    // FSM отпускает ONBOARDING при >= 1.25 (onboardingTargetRatio),
    // эвристика — при >= 1.2 (pillowRatioMin): пороги в ТЗ не совпадают.
    const state = makeState({
      engagementPhase: EngagementPhase.ONBOARDING,
      totalSpins: 10,
    })
    const signals = makeSignals({ balanceRatio: 1.22 })
    expect(nextPhaseByGuards(state, signals, NOW)).toBe(EngagementPhase.ONBOARDING)
    expect(determinePhase(state, signals)).toBe(EngagementPhase.RETENTION)
  })
})
