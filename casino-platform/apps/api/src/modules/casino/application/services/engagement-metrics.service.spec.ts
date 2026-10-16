import { Logger } from '@nestjs/common'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EngagementMetricsService, METRICS_LOG_EVERY_SPINS } from './engagement-metrics.service'

function recordSpins(
  service: EngagementMetricsService,
  count: number,
  overrides: Partial<Parameters<EngagementMetricsService['recordSpin']>[0]> = {},
): void {
  for (let index = 0; index < count; index++) {
    service.recordSpin({
      phase: 'onboarding',
      score: 50,
      rtpDeviationPercent: 0,
      isLdw: false,
      isNearMiss: false,
      ...overrides,
    })
  }
}

describe('§11.1 EngagementMetricsService', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('пустой снапшот — нули и без алертов', () => {
    const snapshot = new EngagementMetricsService().snapshot()
    expect(snapshot.spins).toBe(0)
    expect(snapshot.engagementScoreAvg).toBe(0)
    expect(snapshot.phaseDistribution).toEqual({
      onboarding: 0,
      retention: 0,
      risk: 0,
      reactivation: 0,
      cooldown: 0,
      dormant: 0,
    })
    expect(snapshot.alerts).toEqual([])
  })

  it('агрегирует спины: Score, фазы, RTP-отклонение, LDW и Near-Miss', () => {
    const service = new EngagementMetricsService()
    service.recordSpin({
      phase: 'onboarding',
      score: 50,
      rtpDeviationPercent: 1.5,
      isLdw: true,
      isNearMiss: false,
    })
    service.recordSpin({
      phase: 'retention',
      score: 70,
      rtpDeviationPercent: 0.5,
      isLdw: false,
      isNearMiss: false,
    })
    service.recordSpin({
      phase: 'retention',
      score: 60,
      rtpDeviationPercent: -1,
      isLdw: false,
      isNearMiss: true,
    })
    service.recordSpin({
      phase: 'risk',
      score: 20,
      rtpDeviationPercent: -2,
      isLdw: false,
      isNearMiss: false,
    })

    const snapshot = service.snapshot()
    expect(snapshot.spins).toBe(4)
    expect(snapshot.engagementScoreAvg).toBe(50)
    expect(snapshot.phaseDistribution.onboarding).toBe(0.25)
    expect(snapshot.phaseDistribution.retention).toBe(0.5)
    expect(snapshot.phaseDistribution.risk).toBe(0.25)
    expect(snapshot.rtpAdjustmentAvgPercent).toBe(-0.25)
    expect(snapshot.ldwRate).toBe(0.25)
    expect(snapshot.nearMissRate).toBe(0.25)
  })

  it('реактивации и завершение цикла считаются «на сессию»', () => {
    const service = new EngagementMetricsService()
    service.recordSessionStart()
    service.recordSessionStart()
    service.recordReactivation()
    service.recordReactivation()
    service.recordReactivation()
    service.recordPhaseChange({ from: 'onboarding', to: 'retention' })
    service.recordPhaseChange({ from: 'reactivation', to: 'cooldown' })

    const snapshot = service.snapshot()
    expect(snapshot.reactivationPerSession).toBe(1.5)
    expect(snapshot.balanceCycleCompletionRate).toBe(0.5)
    expect(snapshot.cooldownEntered).toBe(1)
  })

  it('срабатывают все пороги алертов §11.1', () => {
    const service = new EngagementMetricsService()
    // 5 из 10 спинов с LDW (0.5 > 0.4), 4 из 10 — с Near-Miss (0.4 > 0.3).
    recordSpins(service, 5, {
      phase: 'risk',
      score: 10,
      rtpDeviationPercent: 10,
      isLdw: true,
    })
    recordSpins(service, 4, {
      phase: 'risk',
      score: 10,
      rtpDeviationPercent: 10,
      isNearMiss: true,
    })
    recordSpins(service, 1, { phase: 'risk', score: 10, rtpDeviationPercent: 10 })
    service.recordSessionStart()
    for (let index = 0; index < 6; index++) {
      service.recordReactivation()
    }

    const alerts = service.snapshot().alerts
    expect(alerts).toContain('engagement_score_avg_below_30')
    expect(alerts).toContain('phase_risk_share_above_40_percent')
    expect(alerts).toContain('rtp_adjustment_above_5pp')
    expect(alerts).toContain('near_miss_rate_above_30_percent')
    expect(alerts).toContain('ldw_rate_above_40_percent')
    expect(alerts).toContain('reactivation_above_5_per_session')
    expect(alerts).toContain('balance_cycle_completion_below_20_percent')
  })

  it('§11.2 — периодический снапшот уходит в лог каждые 1000 спинов', () => {
    const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    const service = new EngagementMetricsService()
    recordSpins(service, METRICS_LOG_EVERY_SPINS - 1)
    expect(logSpy).not.toHaveBeenCalled()
    recordSpins(service, 1)
    expect(logSpy).toHaveBeenCalledTimes(1)
    recordSpins(service, METRICS_LOG_EVERY_SPINS)
    expect(logSpy).toHaveBeenCalledTimes(2)
  })

  it('emitSnapshot логирует warn при сработавших алертах', () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const service = new EngagementMetricsService()
    recordSpins(service, 10, { phase: 'risk', score: 10, rtpDeviationPercent: 10 })
    const snapshot = service.emitSnapshot()
    expect(snapshot.alerts.length).toBeGreaterThan(0)
    expect(warnSpy).toHaveBeenCalled()
  })

  it('reset очищает счётчики', () => {
    const service = new EngagementMetricsService()
    recordSpins(service, 3)
    service.recordSessionStart()
    service.reset()
    expect(service.snapshot().spins).toBe(0)
    expect(service.snapshot().sessionsStarted).toBe(0)
  })
})
