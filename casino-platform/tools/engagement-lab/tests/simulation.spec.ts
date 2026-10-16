import { Decimal } from 'decimal.js'
import { beforeAll, describe, expect, it } from 'vitest'

import { money } from '@casino/shared-utils'

import { SIMULATION_DEFAULTS, SIMULATION_SUCCESS_CRITERIA } from '../src/config'
import { EngagementPhase } from '../src/domain/engagement-phase'
import { createBaselineEngine } from '../src/engine/baseline-engine'
import { findLabGame } from '../src/game-data'
import {
  computeEngagementMetrics,
  METRIC_ALERT_THRESHOLDS,
} from '../src/metrics/engagement-metrics'
import { createSeededRandom } from '../src/rng'
import { defaultSimulationConfig, runMonteCarlo, type MonteCarloRun } from '../src/sim/monte-carlo'
import {
  analyticSpinStdDevPercent,
  buildSimulationReport,
  type SimulationReport,
} from '../src/sim/report'
import { simulateSession, type SessionResult } from '../src/sim/session'

/**
 * Прогон симуляции на 200 сессиях (§13.2 говорит про 10 000, спеки должны быть
 * быстрыми: масштаб замера делает CLI, тут — форма отчёта, вердикты и
 * детерминизм).
 */
const SPEC_SESSIONS = 200
const SPEC_SPINS = 40
const SPEC_SEED = 20261015
/** Запас по дисперсии для RTP-проверки: σ одного спина Fortune Tiger ~383 п.п. */
const RTP_SIGMA_K = 6

const CRITERION_ROWS = [
  'cumulativeRtp',
  'onboardingSuccessRate',
  'avgReactivationsPerSession',
  'avgBalanceAtCooldown',
  'ldwFrequency',
  'nearMissFrequency',
  'driftCompensationEffectiveness',
] as const

const METRIC_ROWS = [
  'engagement_score_avg',
  'engagement_phase_distribution',
  'rtp_adjustment_avg',
  'near_miss_rate',
  'ldw_rate',
  'reactivation_rate',
  'balance_cycle_completion_rate',
  'avg_session_duration',
] as const

function runBaseline(seed: number, numSessions = SPEC_SESSIONS): MonteCarloRun {
  return runMonteCarlo({
    engine: createBaselineEngine(),
    game: findLabGame('fortunetiger'),
    config: defaultSimulationConfig({
      numSessions,
      avgSessionSpins: SPEC_SPINS,
      depositRange: [SIMULATION_DEFAULTS.depositMin, SIMULATION_DEFAULTS.depositMax],
      betStrategy: SIMULATION_DEFAULTS.betStrategy,
      seed,
    }),
  })
}

function reportOf(run: MonteCarloRun): SimulationReport {
  return buildSimulationReport({ run, metrics: computeEngagementMetrics(run.sessions) })
}

let run: MonteCarloRun
let report: SimulationReport

beforeAll(() => {
  run = runBaseline(SPEC_SEED)
  report = reportOf(run)
})

describe('сессия §13.2', () => {
  it('депозит в диапазоне, спин в лимите, баланс неотрицательный', () => {
    const game = findLabGame('fortunetiger')
    const engine = createBaselineEngine()
    const sessions = [5, 11, 23].map((sessionSeed) =>
      simulateSession({
        engine,
        game,
        params: {
          depositMin: 1_000,
          depositMax: 2_000,
          maxSpins: 25,
          betStrategy: SIMULATION_DEFAULTS.betStrategy,
        },
        random: createSeededRandom(sessionSeed),
        userId: `player-${sessionSeed}`,
        sessionId: `session-${sessionSeed}`,
        startedAt: new Date(0),
      }),
    )

    sessions.forEach((session) => {
      const deposit = new Decimal(session.initialDeposit)
      expect(deposit.gte(1_000) && deposit.lte(2_000)).toBe(true)
      expect(session.totalSpins).toBeLessThanOrEqual(25)
      expect(session.totalSpins).toBeGreaterThan(0)
      expect(new Decimal(session.finalBalance).gte(0)).toBe(true)
      expect(session.totalWins + session.totalLosses).toBe(session.totalSpins)
      expect(Number(money.subtract(session.finalBalance, '0'))).toBeGreaterThanOrEqual(0)
      // Темп спинов model'ируется: без интервалов поведенческие сигналы §6.2 мертвы.
      expect(session.durationMs).toBeGreaterThan(0)
      expect(session.avgTimeBetweenSpinsMs).toBeGreaterThan(0)
      expect(session.avgEngagementScore).toBeGreaterThanOrEqual(0)
      expect(session.avgEngagementScore).toBeLessThanOrEqual(100)
      expect(Object.values(session.phaseSpinCounts).reduce((sum, count) => sum + count, 0)).toBe(
        session.totalSpins,
      )
    })
  })

  it('одинаковый seed и параметры дают идентичную сессию', () => {
    const game = findLabGame('fortunetiger')
    const args = {
      engine: createBaselineEngine(),
      game,
      params: {
        depositMin: 500,
        depositMax: 5_000,
        maxSpins: 30,
        betStrategy: 'martingale' as const,
      },
      random: createSeededRandom(4242),
      userId: 'player-1',
      sessionId: 'session-1',
      startedAt: new Date(0),
    }
    const first = simulateSession(args)
    const second = simulateSession({ ...args, random: createSeededRandom(4242) })
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })
})

describe('отчёт §13.5', () => {
  it('summary содержит все ключи примера из ТЗ', () => {
    expect(Object.keys(report.summary).sort()).toEqual(
      [
        'totalSessions',
        'totalSpins',
        'avgSessionDuration',
        'cumulativeRtp',
        'rtpStdDev',
        'avgReactivationsPerSession',
        'avgBalanceAtCooldown',
        'onboardingSuccessRate',
        'ldwFrequency',
        'nearMissFrequency',
        'driftCompensationEffectiveness',
        // дополнительно к примеру ТЗ:
        'rtpStdDevPerSpin',
        'avgSessionDurationMinutes',
        'avgFinalBalanceRatio',
        'avgSpinsPerSession',
        'sessionsReachedCooldown',
      ].sort(),
    )
    expect(report.summary.totalSessions).toBe(SPEC_SESSIONS)
    expect(report.summary.totalSpins).toBe(
      run.sessions.reduce((sum, session) => sum + session.totalSpins, 0),
    )
    expect(report.summary.avgSessionDuration).toMatch(/ min$/)
    expect(typeof report.summary.cumulativeRtp).toBe('number')
  })

  it('distribution: p50/p90/p99 по sessionDuration и finalBalance', () => {
    expect(Object.keys(report.distribution)).toEqual(['sessionDuration', 'finalBalance'])
    ;[report.distribution.sessionDuration, report.distribution.finalBalance].forEach((block) => {
      expect(block.p50).toBeLessThanOrEqual(block.p90)
      expect(block.p90).toBeLessThanOrEqual(block.p99)
      expect(block.formatted.p50).toMatch(/(min|deposit)$/)
    })
    expect(report.distribution.sessionDuration.unit).toBe('min')
    expect(report.distribution.finalBalance.unit).toBe('% deposit')
  })

  it('отчёт сериализуется в JSON целиком', () => {
    const restored = JSON.parse(JSON.stringify(report)) as SimulationReport
    expect(restored.summary).toEqual(report.summary)
    expect(restored.verdicts).toEqual(report.verdicts)
  })
})

describe('вердикты §13.4', () => {
  it('таблица покрывает все семь метрик критериев', () => {
    expect(report.verdicts.map((row) => row.metric)).toEqual([...CRITERION_ROWS])
    report.verdicts.forEach((row) => {
      expect(row.tzRef).toBe('§13.4')
      expect(row.target.length).toBeGreaterThan(0)
      expect(['PASS', 'WARN', 'FAIL', 'NOT_MEASURABLE']).toContain(row.verdict)
    })
    expect(
      report.counts.pass + report.counts.warn + report.counts.fail + report.counts.notMeasurable,
    ).toBe(report.verdicts.length)
    expect(report.passed).toBe(report.counts.pass === report.verdicts.length)
  })

  it('значения метрик совпадают с summary', () => {
    const byName = new Map(report.verdicts.map((row) => [row.metric, row.value]))
    expect(byName.get('cumulativeRtp')).toBe(report.summary.cumulativeRtp)
    expect(byName.get('onboardingSuccessRate')).toBe(report.summary.onboardingSuccessRate)
    expect(byName.get('avgReactivationsPerSession')).toBe(report.summary.avgReactivationsPerSession)
    expect(byName.get('avgBalanceAtCooldown')).toBe(report.summary.avgBalanceAtCooldown)
    expect(byName.get('ldwFrequency')).toBe(report.summary.ldwFrequency)
    expect(byName.get('nearMissFrequency')).toBe(report.summary.nearMissFrequency)
    expect(byName.get('driftCompensationEffectiveness')).toBe(
      report.summary.driftCompensationEffectiveness,
    )
  })

  it('пороги вердиктов взяты из SIMULATION_SUCCESS_CRITERIA, а не из воздуха', () => {
    const criteria = SIMULATION_SUCCESS_CRITERIA
    const rtpRow = report.verdicts.find((row) => row.metric === 'cumulativeRtp')
    expect(rtpRow?.target).toContain(`${criteria.cumulativeRtpMin}`)
    expect(rtpRow?.target).toContain(`${criteria.cumulativeRtpMax}`)
    const ldwRow = report.verdicts.find((row) => row.metric === 'ldwFrequency')
    expect(ldwRow?.target).toContain(
      `${criteria.ldwFrequencyTarget}±${criteria.ldwFrequencyTolerance}`,
    )
    const driftRow = report.verdicts.find((row) => row.metric === 'driftCompensationEffectiveness')
    expect(driftRow?.target).toContain(`${criteria.driftCompensationMaxPercent}`)
  })

  it('baseline — контрольная группа: манипуляций нет, COOLDOWN недостижим', () => {
    // Это не «упавший» тест, а честный результат плеча §12.2: LDW/Near-Miss/
    // реактивации в baseline не применяются вообще.
    expect(report.summary.ldwFrequency).toBe(0)
    expect(report.summary.nearMissFrequency).toBe(0)
    expect(report.summary.avgReactivationsPerSession).toBe(0)
    expect(report.summary.sessionsReachedCooldown).toBe(0)
    expect(report.summary.avgBalanceAtCooldown).toBeNull()
    const cooldownRow = report.verdicts.find((row) => row.metric === 'avgBalanceAtCooldown')
    expect(cooldownRow?.verdict).toBe('NOT_MEASURABLE')
    const ldwRow = report.verdicts.find((row) => row.metric === 'ldwFrequency')
    expect(ldwRow?.verdict).toBe('FAIL')
    expect(report.passed).toBe(false)
  })

  it('противоречие §13.4 и дисперсия таблицы задокументированы в notes', () => {
    expect(report.notes.join('\n')).toContain('противоречив')
    expect(report.notes.join('\n')).toContain('Дисперсия')
  })
})

describe('метрики §11.1', () => {
  it('восемь метрик с полем alert по порогам таблицы', () => {
    expect(report.metrics.engagementScoreAvg.name).toBe('engagement_score_avg')
    const names = [
      report.metrics.engagementScoreAvg.name,
      report.metrics.engagementPhaseDistribution.name,
      report.metrics.rtpAdjustmentAvg.name,
      report.metrics.nearMissRate.name,
      report.metrics.ldwRate.name,
      report.metrics.reactivationRate.name,
      report.metrics.balanceCycleCompletionRate.name,
      report.metrics.avgSessionDuration.name,
    ]
    expect(names).toEqual([...METRIC_ROWS])
    Object.values(report.metrics).forEach((metric) => {
      expect(typeof metric.alert).toBe('boolean')
      expect(metric.rule).toContain('§11.1')
    })
  })

  it('алерты считаются по порогам', () => {
    expect(report.metrics.balanceCycleCompletionRate.alert).toBe(
      report.metrics.balanceCycleCompletionRate.value <
        METRIC_ALERT_THRESHOLDS.balanceCycleCompletionRateMin,
    )
    expect(report.metrics.avgSessionDuration.alert).toBe(
      report.metrics.avgSessionDuration.value <
        METRIC_ALERT_THRESHOLDS.avgSessionDurationMinutesMin,
    )
    expect(report.metrics.nearMissRate.alert).toBe(false)
    expect(report.metrics.ldwRate.alert).toBe(false)
    expect(report.metrics.engagementPhaseDistribution.value[EngagementPhase.ONBOARDING]).toBe(1)
  })
})

describe('детерминизм прогона', () => {
  it('один seed -> идентичный summary, distribution и вердикты', () => {
    const again = reportOf(runBaseline(SPEC_SEED))
    expect(again.summary).toEqual(report.summary)
    expect(again.distribution).toEqual(report.distribution)
    expect(again.verdicts).toEqual(report.verdicts)
    expect(again.engine).toBe(report.engine)
  })

  it('другой seed -> другой набор сессий', () => {
    const other = reportOf(runBaseline(SPEC_SEED + 1))
    expect(other.summary.cumulativeRtp).not.toBe(report.summary.cumulativeRtp)
  })

  it('baseline RTP в широком допуске вокруг заявленного RTP игры', () => {
    const game = findLabGame('fortunetiger')
    const analyticRtp = Number(game.baseRtp)
    const sigmaPerSpin = analyticSpinStdDevPercent(game, game.baseRtp)
    const totalBet = run.sessions.reduce((sum, session) => sum + Number(session.totalBetAmount), 0)
    const sumBetSquared = run.sessions.reduce((sum, session) => sum + session.sumBetSquared, 0)
    const runSigma = (sigmaPerSpin * Math.sqrt(sumBetSquared)) / totalBet
    const deviation = Math.abs(report.summary.cumulativeRtp - analyticRtp)
    // Узкий допуск §13.4 (±2 п.п.) на 8 000 спинов дал бы ложный провал:
    // только 1σ прогона здесь заметно больше двух процентных пунктов.
    expect(deviation).toBeLessThanOrEqual(RTP_SIGMA_K * runSigma)
    expect(runSigma).toBeGreaterThan(SIMULATION_SUCCESS_CRITERIA.cumulativeRtpTolerance)
    expect(report.summary.cumulativeRtp).toBeGreaterThan(60)
    expect(report.summary.cumulativeRtp).toBeLessThan(140)
  })

  it('остановки сессий исчерпывают набор', () => {
    expect(Object.values(report.stopReasons).reduce((sum, count) => sum + count, 0)).toBe(
      SPEC_SESSIONS,
    )
    run.sessions.forEach((session: SessionResult) => {
      expect(['spin-limit', 'balance-exhausted', 'cooldown', 'dormant']).toContain(
        session.stopReason,
      )
    })
  })
})
