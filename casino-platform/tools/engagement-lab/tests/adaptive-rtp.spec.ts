import { describe, expect, it } from 'vitest'

import { houseSlotRtpCeiling } from '../../../apps/api/src/modules/casino/application/use-cases/house-slot-lottery'
import { RTP_CEILING, RTP_FLOOR, RTP_RANGES, RTP_TUNING } from '../src/config'
import { EngagementPhase } from '../src/domain/engagement-phase'
import { type EngagementState, type PlayerBehaviorSignals } from '../src/domain/types'
import {
  adjustRtp,
  calculateBehaviorModifier,
  compensateRtpDrift,
  smoothRtpTransition,
} from '../src/engine/adaptive-rtp'
import { createInitialState } from '../src/engine/state-transitions'
import { findLabGame, winPayoutsOf } from '../src/game-data'

/** §6.2: нейтральные сигналы — ни один поведенческий вес не активен. */
function signals(overrides: Partial<PlayerBehaviorSignals> = {}): PlayerBehaviorSignals {
  return {
    avgTimeBetweenSpins: 4000,
    spinsInLastMinute: 5,
    spinsInLast5Minutes: 15,
    avgBetSize: '5',
    betTrend: 'stable',
    balanceRatio: 0.5,
    winLossRatio: 1,
    lastWinAmount: '0',
    maxWinInSession: '10',
    decreasingBetCount: false,
    longPauseAfterLoss: false,
    balanceNearZero: false,
    rapidClicking: false,
    slowClicking: false,
    ...overrides,
  }
}

/** Состояние, у которого appliedRtp выставлен в ожидаемый интерполированный RTP. */
function stateFor(overrides: Partial<EngagementState> = {}): EngagementState {
  const base = createInitialState({
    userId: 'player-1',
    gameId: 'fortunetiger',
    sessionId: 'session-1',
    initialDeposit: '1000',
    startedAt: new Date(0),
  })
  return { ...base, ...overrides }
}

describe('§7.1 адаптивный RTP: диапазон фазы и интерполяция', () => {
  it('ONBOARDING: score=0 -> min 105, score=100 -> max 110', () => {
    const low = adjustRtp({
      baseRtp: 96,
      score: 0,
      phase: EngagementPhase.ONBOARDING,
      signals: signals(),
      state: stateFor({ appliedRtp: '105', engagementPhase: EngagementPhase.ONBOARDING }),
      tableCeiling: 110,
    })
    expect(low.targetRtp).toBe('105')
    expect(low.clampedBy).toBe('none')

    const high = adjustRtp({
      baseRtp: 96,
      score: 100,
      phase: EngagementPhase.ONBOARDING,
      signals: signals(),
      state: stateFor({ appliedRtp: '110', engagementPhase: EngagementPhase.ONBOARDING }),
      tableCeiling: 110,
    })
    expect(high.targetRtp).toBe('110')
    expect(high.clampedBy).toBe('none')
  })

  it('RETENTION: score=50 -> середина 96', () => {
    const mid = adjustRtp({
      baseRtp: 96,
      score: 50,
      phase: EngagementPhase.RETENTION,
      signals: signals(),
      state: stateFor({ appliedRtp: '96', engagementPhase: EngagementPhase.RETENTION }),
      tableCeiling: 110,
    })
    expect(mid.targetRtp).toBe('96')
    expect(mid.driftCompensation).toBe(0)
    expect(mid.clampedBy).toBe('none')
  })
})

describe('§7.1 шаг 3: поведенческая корректировка (канон — §7.1, не §6.3)', () => {
  it('азарт сушит RTP: rapidClicking + betTrend increasing = -3', () => {
    expect(
      calculateBehaviorModifier(signals({ rapidClicking: true, betTrend: 'increasing' })),
    ).toBe(-3)
  })

  it('уходящий удерживаем: slowClicking + decreasingBetCount = +5', () => {
    expect(
      calculateBehaviorModifier(signals({ slowClicking: true, decreasingBetCount: true })),
    ).toBe(5)
  })

  it('нейтральные сигналы не сдвигают RTP', () => {
    expect(calculateBehaviorModifier(signals())).toBe(0)
  })

  it('модификаторы не дают выйти за 90..110: ONBOARDING 110 + 5 срезан в 110', () => {
    const result = adjustRtp({
      baseRtp: 96,
      score: 100,
      phase: EngagementPhase.ONBOARDING,
      signals: signals({ slowClicking: true, decreasingBetCount: true }),
      // appliedRtp=110: после глобальной срезки сглаживание держит 110.
      state: stateFor({ appliedRtp: '110', engagementPhase: EngagementPhase.ONBOARDING }),
      tableCeiling: 110,
    })
    // 110 + 5 = 115 -> RTP_CEILING 110.
    expect(result.targetRtp).toBe(String(RTP_CEILING))
    expect(Number(result.targetRtp)).toBeLessThanOrEqual(RTP_CEILING)
    expect(Number(result.targetRtp)).toBeGreaterThanOrEqual(RTP_FLOOR)
    expect(result.clampedBy).toBe('global-range')
  })

  it('пол нижний: RETENTION 94 - 3 и дрейф-кап -3 срезаны в RTP_FLOOR 90', () => {
    // 94 + (-3) = 91, дрейф +40 => cap -3 => 88, затем floor 90.
    const result = adjustRtp({
      baseRtp: 96,
      score: 0,
      phase: EngagementPhase.RETENTION,
      signals: signals({ rapidClicking: true, betTrend: 'increasing' }),
      state: stateFor({
        appliedRtp: '90',
        engagementPhase: EngagementPhase.RETENTION,
        rtpDrift: '40',
      }),
      tableCeiling: 110,
    })
    expect(result.driftCompensation).toBeCloseTo(-3, 6)
    expect(Number(result.targetRtp)).toBeGreaterThanOrEqual(RTP_FLOOR)
    expect(result.targetRtp).toBe(String(RTP_FLOOR))
    expect(result.clampedBy).toBe('global-range')
  })
})

describe('§7.1 шаг 4: компенсация дрейфа cumulative RTP', () => {
  it('drift=+8 -> сдвиг -0.8 (коэффициент 0.1): выше целевого => ниже следующий RTP', () => {
    // RTP_TUNING: factor 0.1, cap 3 => 8*0.1 = 0.8 (кап НЕ достигнут).
    expect(compensateRtpDrift(100, 8)).toBeCloseTo(99.2, 6)
  })

  it('drift=+1 в шумовой полосе (< 2) -> без корректировки', () => {
    expect(compensateRtpDrift(100, 1)).toBe(100)
  })

  it('drift=-4 -> +0.4: ниже целевого => выше следующий RTP', () => {
    expect(compensateRtpDrift(100, -4)).toBeCloseTo(100.4, 6)
  })

  it('кап компенсации = 3: drift=+30 и +40 дают ровно -3', () => {
    expect(compensateRtpDrift(100, 30)).toBeCloseTo(97, 6)
    expect(compensateRtpDrift(100, 40)).toBeCloseTo(97, 6)
    expect(compensateRtpDrift(100, -40)).toBeCloseTo(103, 6)
  })

  it('adjustRtp отдаёт фактический сдвиг дрейфа в метрики §11', () => {
    const result = adjustRtp({
      baseRtp: 96,
      score: 50,
      phase: EngagementPhase.RETENTION,
      signals: signals(),
      // 96 -> drift +8 => -0.8 => 95.2.
      state: stateFor({
        appliedRtp: '95.2',
        engagementPhase: EngagementPhase.RETENTION,
        rtpDrift: '8',
      }),
      tableCeiling: 110,
    })
    expect(result.driftCompensation).toBeCloseTo(-0.8, 6)
    expect(result.targetRtp).toBe('95.2')
  })

  it('шумовая полоса из config: |drift| ровно 2 уже корректируется', () => {
    expect(RTP_TUNING.driftNoiseBandPercent).toBe(2)
    // |2| не < 2 => factor 2*0.1 = 0.2 => 96 - 0.2.
    expect(compensateRtpDrift(96, 2)).toBeCloseTo(95.8, 6)
  })
})

describe('§7.3 сглаживание изменений', () => {
  it('appliedRtp=96, target=110 -> 98 за один спин (шаг 2)', () => {
    expect(RTP_TUNING.maxRtpChangePerSpin).toBe(2)
    expect(smoothRtpTransition(96, 110)).toBe(98)
  })

  it('не меняет, если цель уже достигнута, и не перескакивает через шаг', () => {
    expect(smoothRtpTransition(100, 100)).toBe(100)
    expect(smoothRtpTransition(100, 90)).toBe(98)
    expect(smoothRtpTransition(100, 101)).toBe(101)
  })

  it('adjustRtp применяет сглаживание к интерполированному RTP', () => {
    // ONBOARDING score=100 => target 110; appliedRtp=96 => +2 => 98.
    const result = adjustRtp({
      baseRtp: 96,
      score: 100,
      phase: EngagementPhase.ONBOARDING,
      signals: signals(),
      state: stateFor({ appliedRtp: '96', engagementPhase: EngagementPhase.ONBOARDING }),
      tableCeiling: 110,
    })
    expect(result.targetRtp).toBe('98')
  })
})

describe('потолок таблиц: узкие игры Ox/Panda', () => {
  it('fortuneox: targetRtp срезан реальным houseSlotRtpCeiling, clampedBy=table-ceiling', () => {
    const game = findLabGame('fortuneox')
    const ceiling = houseSlotRtpCeiling(winPayoutsOf(game), game.paylines)
    // узкие таблицы Ox не отдают 105..110: потолок ниже фазового минимума ONBOARDING.
    expect(ceiling).toBeLessThan(RTP_RANGES[EngagementPhase.ONBOARDING].min)

    const result = adjustRtp({
      baseRtp: Number(game.baseRtp),
      score: 100,
      phase: EngagementPhase.ONBOARDING,
      signals: signals(),
      state: stateFor({ appliedRtp: '110', engagementPhase: EngagementPhase.ONBOARDING }),
      tableCeiling: ceiling,
    })
    expect(result.clampedBy).toBe('table-ceiling')
    expect(Number(result.targetRtp)).toBeLessThanOrEqual(ceiling)
    // 6 знаков как колонка rtp в БД.
    expect(result.targetRtp).toBe('89.611223')
  })
})

describe('детерминизм', () => {
  it('одинаковые входы -> идентичный output', () => {
    const args = {
      baseRtp: 96,
      score: 37,
      phase: EngagementPhase.RISK,
      signals: signals({ rapidClicking: true, longPauseAfterLoss: true }),
      state: stateFor({ appliedRtp: '99', engagementPhase: EngagementPhase.RISK, rtpDrift: '5' }),
      tableCeiling: 110,
    }
    const first = adjustRtp(args)
    const second = adjustRtp(args)
    expect(first).toEqual(second)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })
})
