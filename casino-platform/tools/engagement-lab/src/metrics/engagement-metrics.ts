import { Decimal } from 'decimal.js'

import { EngagementPhase } from '../domain/engagement-phase'
import { type SessionResult } from '../sim/session'

/**
 * §11.1, колонка «Алерт»: пороги не вынесены в src/config.ts, поэтому живут
 * здесь и зафиксированы как константа лаборатории (каждый — ровно из таблицы
 * §11.1, ничего не добавлено и не подогнано).
 */
export const METRIC_ALERT_THRESHOLDS = {
  /** engagement_score_avg < 30. */
  engagementScoreAvgMin: 30,
  /** engagement_phase_distribution: доля RISK > 40 %. */
  riskPhaseShareMax: 0.4,
  /** rtp_adjustment_avg: |отклонение| > 5 п.п. */
  rtpAdjustmentAbsMaxPercent: 5,
  /** near_miss_rate > 30 %. */
  nearMissRateMax: 0.3,
  /** ldw_rate > 40 %. */
  ldwRateMax: 0.4,
  /** reactivation_rate > 5 на сессию. */
  reactivationRatePerSessionMax: 5,
  /** balance_cycle_completion_rate < 20 %. */
  balanceCycleCompletionRateMin: 0.2,
  /** avg_session_duration < 5 минут. */
  avgSessionDurationMinutesMin: 5,
} as const

export type MetricValue<TValue> = {
  name: string
  value: TValue
  /** true — значение вышло за порог §11.1. */
  alert: boolean
  /** Порог §11.1 текстом: чтобы отчёт читался без ТЗ под рукой. */
  rule: string
}

export interface EngagementMetrics {
  engagementScoreAvg: MetricValue<number>
  engagementPhaseDistribution: MetricValue<Record<EngagementPhase, number>>
  rtpAdjustmentAvg: MetricValue<number>
  nearMissRate: MetricValue<number>
  ldwRate: MetricValue<number>
  reactivationRate: MetricValue<number>
  balanceCycleCompletionRate: MetricValue<number>
  avgSessionDuration: MetricValue<number>
}

export interface EngagementMetricsResult {
  metrics: EngagementMetrics
  /** Плоский список §11.1: восемь метрик в порядке таблицы, для отчёта и CLI. */
  alerts: MetricValue<number | Record<EngagementPhase, number>>[]
}

function shareOf(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole
}

/** Значения метрик — четыре знака: JSON отчёта должен читаться глазами. */
function roundMetric(value: number): number {
  return Number(new Decimal(value).toDecimalPlaces(4).toString())
}

function sumSpins(sessions: readonly SessionResult[]): number {
  return sessions.reduce((total, session) => total + session.totalSpins, 0)
}

function sumField(
  sessions: readonly SessionResult[],
  pick: (session: SessionResult) => number,
): number {
  return sessions.reduce((total, session) => total + pick(session), 0)
}

/** Доли спинов по фазам: фаза, в которой реально делался спин (§5.3, §11.1). */
function phaseDistributionOf(sessions: readonly SessionResult[]): Record<EngagementPhase, number> {
  const totals = Object.values(EngagementPhase).reduce(
    (accumulator, phase) => {
      accumulator[phase] = 0
      return accumulator
    },
    {} as Record<EngagementPhase, number>,
  )
  sessions.forEach((session) => {
    Object.values(EngagementPhase).forEach((phase) => {
      totals[phase] += session.phaseSpinCounts[phase] ?? 0
    })
  })
  const spins = sumSpins(sessions)
  return Object.fromEntries(
    Object.entries(totals).map(([phase, count]) => [phase, roundMetric(shareOf(count, spins))]),
  ) as Record<EngagementPhase, number>
}

/** Сырые значения всех восьми метрик до упаковки в MetricValue (§11.1). */
interface MetricRates {
  engagementScoreAvg: number
  rtpAdjustmentAvg: number
  nearMissRate: number
  ldwRate: number
  reactivationRate: number
  balanceCycleCompletionRate: number
  avgSessionDuration: number
  phaseDistribution: Record<EngagementPhase, number>
}

function computeMetricRates(sessions: readonly SessionResult[]): MetricRates {
  const spins = sumSpins(sessions)
  const sessionCount = sessions.length
  return {
    engagementScoreAvg: shareOf(
      sumField(sessions, (session) => session.avgEngagementScore * session.totalSpins),
      spins,
    ),
    rtpAdjustmentAvg: shareOf(
      sumField(sessions, (session) => session.rtpAdjustmentMeanAbsDeviation * session.totalSpins),
      spins,
    ),
    nearMissRate: shareOf(
      sumField(sessions, (session) => session.nearMissCount),
      spins,
    ),
    ldwRate: shareOf(
      sumField(sessions, (session) => session.ldwCount),
      spins,
    ),
    reactivationRate: shareOf(
      sumField(sessions, (session) => session.reactivationCount),
      sessionCount,
    ),
    balanceCycleCompletionRate: shareOf(
      sessions.filter((session) => session.fullCycleCompleted).length,
      sessionCount,
    ),
    avgSessionDuration: shareOf(
      sumField(sessions, (session) => session.durationMinutes),
      sessionCount,
    ),
    phaseDistribution: phaseDistributionOf(sessions),
  }
}

type CoreMetrics = Pick<
  EngagementMetrics,
  'engagementScoreAvg' | 'engagementPhaseDistribution' | 'rtpAdjustmentAvg' | 'nearMissRate'
>

function buildCoreMetrics(rates: MetricRates): CoreMetrics {
  const engagementScoreAvgMetric: MetricValue<number> = {
    name: 'engagement_score_avg',
    value: roundMetric(rates.engagementScoreAvg),
    alert: rates.engagementScoreAvg < METRIC_ALERT_THRESHOLDS.engagementScoreAvgMin,
    rule: `< ${METRIC_ALERT_THRESHOLDS.engagementScoreAvgMin} (§11.1)`,
  }
  const phaseDistributionMetric: MetricValue<Record<EngagementPhase, number>> = {
    name: 'engagement_phase_distribution',
    value: rates.phaseDistribution,
    alert:
      (rates.phaseDistribution[EngagementPhase.RISK] ?? 0) >
      METRIC_ALERT_THRESHOLDS.riskPhaseShareMax,
    rule: `RISK > ${METRIC_ALERT_THRESHOLDS.riskPhaseShareMax * 100}% (§11.1)`,
  }
  const rtpAdjustmentMetric: MetricValue<number> = {
    name: 'rtp_adjustment_avg',
    value: roundMetric(rates.rtpAdjustmentAvg),
    alert: rates.rtpAdjustmentAvg > METRIC_ALERT_THRESHOLDS.rtpAdjustmentAbsMaxPercent,
    rule: `> ±${METRIC_ALERT_THRESHOLDS.rtpAdjustmentAbsMaxPercent}% (§11.1)`,
  }
  const nearMissMetric: MetricValue<number> = {
    name: 'near_miss_rate',
    value: rates.nearMissRate,
    alert: rates.nearMissRate > METRIC_ALERT_THRESHOLDS.nearMissRateMax,
    rule: `> ${METRIC_ALERT_THRESHOLDS.nearMissRateMax * 100}% (§11.1)`,
  }

  return {
    engagementScoreAvg: engagementScoreAvgMetric,
    engagementPhaseDistribution: phaseDistributionMetric,
    rtpAdjustmentAvg: rtpAdjustmentMetric,
    nearMissRate: nearMissMetric,
  }
}

type MechanicMetrics = Pick<
  EngagementMetrics,
  'ldwRate' | 'reactivationRate' | 'balanceCycleCompletionRate' | 'avgSessionDuration'
>

function buildMechanicMetrics(rates: MetricRates): MechanicMetrics {
  const ldwMetric: MetricValue<number> = {
    name: 'ldw_rate',
    value: rates.ldwRate,
    alert: rates.ldwRate > METRIC_ALERT_THRESHOLDS.ldwRateMax,
    rule: `> ${METRIC_ALERT_THRESHOLDS.ldwRateMax * 100}% (§11.1)`,
  }
  const reactivationMetric: MetricValue<number> = {
    name: 'reactivation_rate',
    value: rates.reactivationRate,
    alert: rates.reactivationRate > METRIC_ALERT_THRESHOLDS.reactivationRatePerSessionMax,
    rule: `> ${METRIC_ALERT_THRESHOLDS.reactivationRatePerSessionMax}/сессия (§11.1)`,
  }
  const balanceCycleMetric: MetricValue<number> = {
    name: 'balance_cycle_completion_rate',
    value: rates.balanceCycleCompletionRate,
    alert: rates.balanceCycleCompletionRate < METRIC_ALERT_THRESHOLDS.balanceCycleCompletionRateMin,
    rule: `< ${METRIC_ALERT_THRESHOLDS.balanceCycleCompletionRateMin * 100}% (§11.1)`,
  }
  const sessionDurationMetric: MetricValue<number> = {
    name: 'avg_session_duration',
    value: rates.avgSessionDuration,
    alert: rates.avgSessionDuration < METRIC_ALERT_THRESHOLDS.avgSessionDurationMinutesMin,
    rule: `< ${METRIC_ALERT_THRESHOLDS.avgSessionDurationMinutesMin} мин (§11.1)`,
  }

  return {
    ldwRate: ldwMetric,
    reactivationRate: reactivationMetric,
    balanceCycleCompletionRate: balanceCycleMetric,
    avgSessionDuration: sessionDurationMetric,
  }
}

function buildMetricValues(rates: MetricRates): EngagementMetrics {
  return { ...buildCoreMetrics(rates), ...buildMechanicMetrics(rates) }
}

/** Плоский список §11.1: восемь метрик в порядке таблицы, для отчёта и CLI. */
function orderedAlerts(
  metrics: EngagementMetrics,
): MetricValue<number | Record<EngagementPhase, number>>[] {
  return [
    metrics.engagementScoreAvg,
    metrics.engagementPhaseDistribution,
    metrics.rtpAdjustmentAvg,
    metrics.nearMissRate,
    metrics.ldwRate,
    metrics.reactivationRate,
    metrics.balanceCycleCompletionRate,
    metrics.avgSessionDuration,
  ]
}

/**
 * Восемь метрик §11.1 по набору сессий.
 *
 * Доли (near-miss, LDW, фазы) считаются по всем спинам прогона, а не как среднее
 * долей по сессиям: короткие сессии не должны весить столько же, сколько длинные.
 * avg_session_duration — минуты (в таблице §11.1 порог задан в минутах).
 */
export function computeEngagementMetrics(
  sessions: readonly SessionResult[],
): EngagementMetricsResult {
  const metrics = buildMetricValues(computeMetricRates(sessions))
  return { metrics, alerts: orderedAlerts(metrics) }
}
