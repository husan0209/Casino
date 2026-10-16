import { describe, expect, it } from 'vitest'

import { adjustRtp, compensateRtpDrift, phaseTargetRtp, smoothRtpTransition } from './adaptive-rtp'
import { DEFAULT_ENGAGEMENT_CONFIG, RTP_RANGES } from './engagement-config'
import { createEngagementState, type EngagementState } from './engagement-state.vo'
import { computeBehaviorSignals, type PlayerBehaviorSignals } from './player-behavior.vo'

const CONFIG = DEFAULT_ENGAGEMENT_CONFIG

function freshState(overrides: Partial<EngagementState> = {}): EngagementState {
  const base = createEngagementState({
    userId: 'user-1',
    gameId: 'game-1',
    currency: 'RUB',
    initialDeposit: '1000',
    currentBalance: '1000',
  })
  return { ...base, ...overrides }
}

function signalsWith(overrides: Partial<PlayerBehaviorSignals> = {}): PlayerBehaviorSignals {
  const state = freshState()
  return { ...computeBehaviorSignals(state, '1000'), ...overrides }
}

describe('§7.1 адаптивный RTP', () => {
  it('ONBOARDING даёт завышенный RTP (§5.3: 105–110)', () => {
    const result = adjustRtp({
      baseRtpPercent: 96,
      score: 50,
      phase: 'onboarding',
      signals: signalsWith(),
      state: freshState(),
      config: CONFIG,
      tableCeilingPercent: null,
    })
    expect(result.rtpPercent).toBeGreaterThanOrEqual(105)
    expect(result.rtpPercent).toBeLessThanOrEqual(110)
  })

  it('RETENTION держит RTP ниже 100 % (§7.2: 94–98)', () => {
    const result = adjustRtp({
      baseRtpPercent: 96,
      score: 50,
      phase: 'retention',
      signals: signalsWith(),
      state: freshState(),
      config: CONFIG,
      tableCeilingPercent: null,
    })
    expect(result.rtpPercent).toBeGreaterThanOrEqual(94)
    expect(result.rtpPercent).toBeLessThanOrEqual(98)
  })

  it('COOLDOWN возвращает базовый RTP игры без манипуляций (§5.3)', () => {
    const result = adjustRtp({
      baseRtpPercent: 96,
      score: 100,
      phase: 'cooldown',
      signals: signalsWith({ rapidClicking: false, betTrend: 'stable' }),
      state: freshState({ rtpDrift: '50' }),
      config: CONFIG,
      tableCeilingPercent: null,
    })
    // Базовый RTP, без поведенческой поправки и без компенсации дрейфа.
    expect(result.rtpPercent).toBe(96)
    expect(result.behaviorModifier).toBe(0)
    expect(result.driftCompensation).toBe(0)
  })

  it('интерполирует RTP по Score внутри диапазона фазы', () => {
    expect(phaseTargetRtp('retention', 0)).toBe(RTP_RANGES.retention.min)
    expect(phaseTargetRtp('retention', 100)).toBe(RTP_RANGES.retention.max)
  })

  it('сушит азартного игрока и удерживает уходящего (§7.1 шаг 3)', () => {
    const hot = adjustRtp({
      baseRtpPercent: 96,
      score: 50,
      phase: 'retention',
      signals: signalsWith({ rapidClicking: true, betTrend: 'increasing' }),
      state: freshState(),
      config: CONFIG,
      tableCeilingPercent: null,
    })
    const cold = adjustRtp({
      baseRtpPercent: 96,
      score: 50,
      phase: 'retention',
      signals: signalsWith({ slowClicking: true, decreasingBetCount: true }),
      state: freshState(),
      config: CONFIG,
      tableCeilingPercent: null,
    })
    expect(hot.rtpPercent).toBeLessThan(cold.rtpPercent)
  })

  it('удерживает RTP в глобальных границах 90…110 (§17)', () => {
    const high = adjustRtp({
      baseRtpPercent: 96,
      score: 100,
      phase: 'reactivation',
      signals: signalsWith({
        slowClicking: true,
        decreasingBetCount: true,
        longPauseAfterLoss: true,
      }),
      state: freshState({ rtpDrift: '-500' }),
      config: CONFIG,
      tableCeilingPercent: null,
    })
    expect(high.rtpPercent).toBeLessThanOrEqual(CONFIG.rtpMaxPercent)
    expect(high.rtpPercent).toBeGreaterThanOrEqual(CONFIG.rtpMinPercent)
  })

  it('не превышает потолок таблицы выплат (§17)', () => {
    const result = adjustRtp({
      baseRtpPercent: 96,
      score: 100,
      phase: 'onboarding',
      signals: signalsWith(),
      state: freshState(),
      config: CONFIG,
      tableCeilingPercent: 92,
    })
    expect(result.rtpPercent).toBe(92)
    expect(result.clampedByTableCeiling).toBe(true)
  })
})

describe('§7 компенсация дрейфа и сглаживание', () => {
  it('игнорирует дрейф ниже порога — это шум', () => {
    expect(compensateRtpDrift(96, '1.5', CONFIG)).toBe(96)
  })

  it('снижает RTP, если казино переплатило (drift > 0)', () => {
    expect(compensateRtpDrift(96, '30', CONFIG)).toBeLessThan(96)
  })

  it('повышает RTP, если казино недоплатило (drift < 0)', () => {
    expect(compensateRtpDrift(96, '-30', CONFIG)).toBeGreaterThan(96)
  })

  it('ограничивает компенсацию тремя пунктами', () => {
    // 0.1 * 1000 = 100 → обрезается потолком 3 п.п.
    expect(compensateRtpDrift(96, '1000', CONFIG)).toBe(93)
  })

  it('сглаживает скачок не больше чем на 2 п.п. за спин (§7.3)', () => {
    expect(smoothRtpTransition(96, 110, 2)).toBe(98)
    expect(smoothRtpTransition(96, 97, 2)).toBe(97)
  })
})
