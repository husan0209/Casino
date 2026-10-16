/**
 * ТЗ ч.9 §11.1–§11.2 — метрики движка вовлечения.
 *
 * Бэкенда метрик (Prometheus/OTel) в проекте нет по решению ТЗ ч.7 §12.1:
 * мониторинг MVP — health-эндпоинты, UptimeRobot и структурные логи. Поэтому
 * метрики живут как счётчики процесса и регулярно уходят в Pino одной строкой
 * `engagement_metrics` (§11.2): по ней алерты §11.1 настраиваются в лог-бэкенде.
 *
 * Метрики, требующие данных за пределами процесса (retention, ARPU, LTV,
 * средняя длительность сессии), здесь не считаются — их источник — журнал
 * `engagement_events` (§3.3) и логи; см. docs/PLAYER_ENGAGEMENT_OVERVIEW.md.
 */
import { Injectable, Logger } from '@nestjs/common'

import type { EngagementPhase } from '../../domain/engagement'

/** Как часто агрегат уходит в лог (в спинах). */
export const METRICS_LOG_EVERY_SPINS = 1000

/** §11.1 — пороги алертов; при нарушении пишется warn-строка. */
export const ENGAGEMENT_METRIC_ALERTS = {
  scoreAvgBelow: 30,
  riskShareAbove: 0.4,
  rtpAdjustmentAbsAbove: 5,
  nearMissRateAbove: 0.3,
  ldwRateAbove: 0.4,
  reactivationPerSessionAbove: 5,
  cycleCompletionBelow: 0.2,
} as const

export interface EngagementMetricsSnapshot {
  readonly spins: number
  readonly sessionsStarted: number
  /** §11.1 `engagement_score_avg` — средний Score по спинам. */
  readonly engagementScoreAvg: number
  /** §11.1 `engagement_phase_distribution` — доли спинов по фазам. */
  readonly phaseDistribution: Readonly<Record<EngagementPhase, number>>
  /** §11.1 `rtp_adjustment_avg` — среднее отклонение RTP от базового, п.п. */
  readonly rtpAdjustmentAvgPercent: number
  /** §11.1 `near_miss_rate` — доля спинов с Near-Miss. */
  readonly nearMissRate: number
  /** §11.1 `ldw_rate` — доля спинов с LDW. */
  readonly ldwRate: number
  /** §11.1 `reactivation_rate` — триггеры реактивации на сессию. */
  readonly reactivationPerSession: number
  /** §11.1 `balance_cycle_completion_rate` — доля сессий, дошедших ONBOARDING → RETENTION. */
  readonly balanceCycleCompletionRate: number
  readonly cooldownEntered: number
  /** §11.1 — сработавшие пороги алертов (человекочитаемые ярлыки). */
  readonly alerts: readonly string[]
}

interface MetricsCounters {
  spins: number
  scoreSum: number
  phaseSpins: Record<EngagementPhase, number>
  rtpDeviationSum: number
  ldwCount: number
  nearMissCount: number
  reactivationCount: number
  sessionsStarted: number
  onboardingCompleted: number
  cooldownEntered: number
  sinceLastLog: number
}

function emptyCounters(): MetricsCounters {
  return {
    spins: 0,
    scoreSum: 0,
    phaseSpins: {
      onboarding: 0,
      retention: 0,
      risk: 0,
      reactivation: 0,
      cooldown: 0,
      dormant: 0,
    },
    rtpDeviationSum: 0,
    ldwCount: 0,
    nearMissCount: 0,
    reactivationCount: 0,
    sessionsStarted: 0,
    onboardingCompleted: 0,
    cooldownEntered: 0,
    sinceLastLog: 0,
  }
}

@Injectable()
export class EngagementMetricsService {
  private readonly logger = new Logger(EngagementMetricsService.name)
  private counters: MetricsCounters = emptyCounters()

  /** Новая пара или сброшенная сессия (§10.1) — знаменатель «на сессию». */
  recordSessionStart(): void {
    this.counters.sessionsStarted += 1
  }

  /** Спин: фаза, Score и фактическое отклонение RTP от базового (п.п.). */
  recordSpin(args: {
    phase: EngagementPhase
    score: number
    rtpDeviationPercent: number
    isLdw: boolean
    isNearMiss: boolean
  }): void {
    this.counters.spins += 1
    this.counters.scoreSum += args.score
    this.counters.phaseSpins[args.phase] += 1
    this.counters.rtpDeviationSum += args.rtpDeviationPercent
    if (args.isLdw) {
      this.counters.ldwCount += 1
    }
    if (args.isNearMiss) {
      this.counters.nearMissCount += 1
    }
    this.maybeLogPeriodicSnapshot()
  }

  recordReactivation(): void {
    this.counters.reactivationCount += 1
  }

  recordPhaseChange(args: { from: EngagementPhase; to: EngagementPhase }): void {
    if (args.from === 'onboarding' && args.to === 'retention') {
      this.counters.onboardingCompleted += 1
    }
    if (args.to === 'cooldown') {
      this.counters.cooldownEntered += 1
    }
  }

  snapshot(): EngagementMetricsSnapshot {
    const { counters } = this
    const spins = counters.spins
    const phaseDistribution = Object.fromEntries(
      Object.entries(counters.phaseSpins).map(([phase, count]) => [
        phase,
        spins === 0 ? 0 : Number((count / spins).toFixed(4)),
      ]),
    ) as Record<EngagementPhase, number>
    const sessions = Math.max(counters.sessionsStarted, 1)
    const result: EngagementMetricsSnapshot = {
      spins,
      sessionsStarted: counters.sessionsStarted,
      engagementScoreAvg: spins === 0 ? 0 : Number((counters.scoreSum / spins).toFixed(2)),
      phaseDistribution,
      rtpAdjustmentAvgPercent:
        spins === 0 ? 0 : Number((counters.rtpDeviationSum / spins).toFixed(3)),
      nearMissRate: spins === 0 ? 0 : Number((counters.nearMissCount / spins).toFixed(4)),
      ldwRate: spins === 0 ? 0 : Number((counters.ldwCount / spins).toFixed(4)),
      reactivationPerSession: Number((counters.reactivationCount / sessions).toFixed(3)),
      balanceCycleCompletionRate: Number((counters.onboardingCompleted / sessions).toFixed(4)),
      cooldownEntered: counters.cooldownEntered,
      alerts: [],
    }
    return { ...result, alerts: this.evaluateAlerts(result) }
  }

  /** Сброс счётчиков — для тестов и ручного контроля. */
  reset(): void {
    this.counters = emptyCounters()
  }

  private evaluateAlerts(snapshot: EngagementMetricsSnapshot): string[] {
    if (snapshot.spins === 0) {
      return []
    }
    // Пороги «на спин»: доля фазы risk, средние Score/RTP, частоты механик.
    const spinChecks: Array<readonly [boolean, string]> = [
      [
        snapshot.engagementScoreAvg < ENGAGEMENT_METRIC_ALERTS.scoreAvgBelow,
        'engagement_score_avg_below_30',
      ],
      [
        snapshot.phaseDistribution.risk > ENGAGEMENT_METRIC_ALERTS.riskShareAbove,
        'phase_risk_share_above_40_percent',
      ],
      [
        Math.abs(snapshot.rtpAdjustmentAvgPercent) > ENGAGEMENT_METRIC_ALERTS.rtpAdjustmentAbsAbove,
        'rtp_adjustment_above_5pp',
      ],
      [
        snapshot.nearMissRate > ENGAGEMENT_METRIC_ALERTS.nearMissRateAbove,
        'near_miss_rate_above_30_percent',
      ],
      [snapshot.ldwRate > ENGAGEMENT_METRIC_ALERTS.ldwRateAbove, 'ldw_rate_above_40_percent'],
    ]
    const alerts = spinChecks.filter(([broken]) => broken).map(([, label]) => label)
    return [...alerts, ...this.evaluateSessionAlerts(snapshot)]
  }

  /** Пороги «на сессию»: без завершённых сессий их знаменатель неизвестен. */
  private evaluateSessionAlerts(snapshot: EngagementMetricsSnapshot): string[] {
    if (snapshot.sessionsStarted === 0) {
      return []
    }
    const alerts: string[] = []
    if (snapshot.reactivationPerSession > ENGAGEMENT_METRIC_ALERTS.reactivationPerSessionAbove) {
      alerts.push('reactivation_above_5_per_session')
    }
    if (snapshot.balanceCycleCompletionRate < ENGAGEMENT_METRIC_ALERTS.cycleCompletionBelow) {
      alerts.push('balance_cycle_completion_below_20_percent')
    }
    return alerts
  }

  /** §11.2 — периодический снапшот в лог: агрегаты §11.1 доступны мониторингу. */
  private maybeLogPeriodicSnapshot(): void {
    this.counters.sinceLastLog += 1
    if (this.counters.sinceLastLog < METRICS_LOG_EVERY_SPINS) {
      return
    }
    this.counters.sinceLastLog = 0
    this.emitSnapshot()
  }

  emitSnapshot(): EngagementMetricsSnapshot {
    const snapshot = this.snapshot()
    this.logger.log({ engagement_metrics: snapshot })
    if (snapshot.alerts.length > 0) {
      this.logger.warn({ engagement_metrics_alert: snapshot.alerts, engagement_metrics: snapshot })
    }
    return snapshot
  }
}
