import { Decimal } from 'decimal.js'

import { money } from '@casino/shared-utils'

import { buildHouseSlotLottery } from '../../../../apps/api/src/modules/casino/application/use-cases/house-slot-lottery'
import { RTP_RANGES, SIMULATION_SUCCESS_CRITERIA, ZERO } from '../config'
import { type MonteCarloRun } from './monte-carlo'
import { type SessionResult, type SessionStopReason } from './session'
import { EngagementPhase } from '../domain/engagement-phase'
import { type LabGame, type MoneyAmount } from '../domain/types'
import { winPayoutsOf } from '../game-data'
import {
  computeEngagementMetrics,
  type EngagementMetricsResult,
} from '../metrics/engagement-metrics'

export type Verdict = 'PASS' | 'WARN' | 'FAIL' | 'NOT_MEASURABLE'

/** Строка таблицы вердиктов §13.4. */
export interface VerdictRow {
  metric: string
  value: number | null
  /** Целевой диапазон текстом — числа всегда из SIMULATION_SUCCESS_CRITERIA. */
  target: string
  verdict: Verdict
  reason: string | null
  tzRef: string
}

/** §13.5: summary прогона. */
export interface SimulationSummary {
  totalSessions: number
  totalSpins: number
  avgSessionDuration: string
  avgSessionDurationMinutes: number
  cumulativeRtp: number
  rtpStdDev: number
  /** СКО одного спина по весам лотереи, п.п. RTP (README «Проверенное на каркасе»). */
  rtpStdDevPerSpin: number
  onboardingSuccessRate: number
  avgReactivationsPerSession: number
  avgBalanceAtCooldown: number | null
  sessionsReachedCooldown: number
  ldwFrequency: number
  nearMissFrequency: number
  driftCompensationEffectiveness: number
  avgFinalBalanceRatio: number
  avgSpinsPerSession: number
}

/** §13.5: квантили; строки — как в примере ТЗ, числа — для расчётов. */
export interface DistributionBlock {
  unit: string
  p50: number
  p90: number
  p99: number
  formatted: { p50: string; p90: string; p99: string }
}

export interface SimulationReport {
  engine: string
  /** Срез игры: полные таблицы исходов в JSON отчёта класть не нужно. */
  game: { externalGameId: string; displayName: string; baseRtp: MoneyAmount; paylines: number }
  config: MonteCarloRun['config']
  summary: SimulationSummary
  distribution: {
    sessionDuration: DistributionBlock
    finalBalance: DistributionBlock
  }
  verdicts: VerdictRow[]
  /** §11.1: восемь метрик мониторинга с флагом alert. */
  metrics: EngagementMetricsResult['metrics']
  stopReasons: Record<SessionStopReason, number>
  passed: boolean
  counts: { pass: number; warn: number; fail: number; notMeasurable: number }
  notes: string[]
}

const PERCENT = 100
/** Границы провала §13.4 для LDW/Near-Miss = цель ± 2*допуск (иначе числа брать неоткуда). */
const FAIL_BOUND_MULTIPLIER = 2

function roundTo(value: number, places: number): number {
  return Number(new Decimal(value).toDecimalPlaces(places).toString())
}

function share(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole
}

function rank(sortedValues: readonly number[], quantile: number): number {
  // nearest-rank: p50/p90/p99 = элемент с индексом ceil(q*n)-1. Интерполяция
  // только добавила бы иллюзию точности на 200 сессиях.
  if (sortedValues.length === 0) {
    return 0
  }
  const position = Math.max(1, Math.ceil(quantile * sortedValues.length))
  return sortedValues[Math.min(sortedValues.length - 1, position - 1)] ?? 0
}

function distributionBlock(
  values: readonly number[],
  unit: string,
  format: (value: number) => string,
): DistributionBlock {
  const sorted = [...values].sort((left, right) => left - right)
  const marks = { p50: rank(sorted, 0.5), p90: rank(sorted, 0.9), p99: rank(sorted, 0.99) }
  return {
    unit,
    p50: roundTo(marks.p50, 6),
    p90: roundTo(marks.p90, 6),
    p99: roundTo(marks.p99, 6),
    formatted: {
      p50: format(marks.p50),
      p90: format(marks.p90),
      p99: format(marks.p99),
    },
  }
}

const MINUTES_FORMAT = (value: number): string => `${roundTo(value, 1)} min`
const DEPOSIT_SHARE_FORMAT = (value: number): string => `${roundTo(value * PERCENT, 1)}% deposit`

/**
 * Аналитическое СКО одного спина в долях ставки по весам лотереи. Без этой
 * цифры допуск §13.4 «96 ± 2» на коротком прогоне читается как поломка движка,
 * хотя это дисперсия таблицы (README: две строки Fortune Tiger платят 250x).
 */
export function analyticSpinStdDevPercent(game: LabGame, targetRtp: MoneyAmount): number {
  const payouts = winPayoutsOf(game)
  const lottery = buildHouseSlotLottery({
    gameCode: game.externalGameId,
    winPayouts: payouts,
    targetRtp,
    paylines: game.paylines,
  })
  const mean = lottery.winProbabilities.reduce(
    (total, probability, index) => total + probability * ((payouts[index] ?? 0) / game.paylines),
    0,
  )
  const meanSquare = lottery.winProbabilities.reduce(
    (total, probability, index) =>
      total + probability * ((payouts[index] ?? 0) / game.paylines) ** 2,
    0,
  )
  return Math.sqrt(Math.max(0, meanSquare - mean ** 2)) * PERCENT
}

/** Накопленный RTP прогона: Σ выигрышей / Σ ставок, как в §3.1. */
function pooledRtpPercent(sessions: readonly SessionResult[]): number {
  const totalBet = sessions.reduce((sum, session) => money.add(sum, session.totalBetAmount), ZERO)
  const totalWin = sessions.reduce((sum, session) => money.add(sum, session.totalWinAmount), ZERO)
  if (!money.isGreaterThan(totalBet, ZERO)) {
    return 0
  }
  return new Decimal(money.divide(money.multiply(totalWin, String(PERCENT)), totalBet)).toNumber()
}

function sampleStdDev(values: readonly number[]): number {
  if (values.length < 2) {
    return 0
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

interface Band {
  passLower: number
  passUpper: number
  failLower: number | null
  failUpper: number | null
  /** §13.4 пишет «< 5/сессию» и «> 85 %»: строгая граница сверху/снизу. */
  strictLower?: boolean
  strictUpper?: boolean
}

function gradeBand(value: number, band: Band): Verdict {
  const aboveLower = band.strictLower ? value > band.passLower : value >= band.passLower
  const belowUpper = band.strictUpper ? value < band.passUpper : value <= band.passUpper
  if (aboveLower && belowUpper) {
    return 'PASS'
  }
  if (band.failLower !== null && value < band.failLower) {
    return 'FAIL'
  }
  if (band.failUpper !== null && value > band.failUpper) {
    return 'FAIL'
  }
  return 'WARN'
}

function countStopReasons(sessions: readonly SessionResult[]): Record<SessionStopReason, number> {
  const reasons: Record<SessionStopReason, number> = {
    'spin-limit': 0,
    'balance-exhausted': 0,
    cooldown: 0,
    dormant: 0,
  }
  sessions.forEach((session) => {
    reasons[session.stopReason] += 1
  })
  return reasons
}

/** Сноска про дисперсию: почему §13.4 не может быть зелёным на коротком прогоне. */
function dispersionNote(stdDevPercentPerSpin: number, totalSpins: number): string {
  const runSigma = totalSpins === 0 ? 0 : stdDevPercentPerSpin / Math.sqrt(totalSpins)
  return (
    `Дисперсия: σ одного спина = ${roundTo(stdDevPercentPerSpin, 2)} п.п. RTP, ` +
    `σ прогона из ${totalSpins} спинов = ±${roundTo(runSigma, 2)} п.п. (аналитика по весам лотереи). ` +
    `Допуск §13.4 «±${SIMULATION_SUCCESS_CRITERIA.cumulativeRtpTolerance} п.п.» уже этой сигмы, ` +
    `поэтому FAIL на коротком прогоне говорит о выборке, а не о математике (README «Проверенное на каркасе»).`
  )
}

function mechanicReason(engineName: string, label: string): string | null {
  return engineName === 'baseline'
    ? `Контрольная группа §12.2 намеренно не применяет ${label} (§8.1/§8.2) — ноль здесь ожидаем, критерий относится к плечу engagement`
    : null
}

function countSpins(sessions: readonly SessionResult[]): number {
  return sessions.reduce((sum, session) => sum + session.totalSpins, 0)
}

/** Сырые метрики отчёта до упаковки в summary/вердикты (§13.4, §13.5). */
interface ReportRates {
  cumulativeRtp: number
  onboardingSuccessRate: number
  avgReactivationsPerSession: number
  avgBalanceAtCooldown: number | null
  ldwFrequency: number
  nearMissFrequency: number
  avgSessionDurationMinutes: number
  driftCompensationEffectiveness: number
}

function computeReportRates(sessions: readonly SessionResult[], totalSpins: number): ReportRates {
  const sessionCount = sessions.length
  const cooldownSessions = sessions.filter((session) => session.reachedCooldown)
  return {
    cumulativeRtp: roundTo(pooledRtpPercent(sessions), 4),
    onboardingSuccessRate: share(
      sessions.filter((session) => session.onboardingGoalReached).length,
      sessionCount,
    ),
    avgReactivationsPerSession: share(
      sessions.reduce((sum, session) => sum + session.reactivationCount, 0),
      sessionCount,
    ),
    avgBalanceAtCooldown:
      cooldownSessions.length === 0
        ? null
        : roundTo(
            share(
              cooldownSessions.reduce((sum, session) => sum + session.balanceRatioAtEnd, 0),
              cooldownSessions.length,
            ),
            6,
          ),
    ldwFrequency: share(
      sessions.reduce((sum, session) => sum + session.ldwCount, 0),
      totalSpins,
    ),
    nearMissFrequency: share(
      sessions.reduce((sum, session) => sum + session.nearMissCount, 0),
      totalSpins,
    ),
    avgSessionDurationMinutes: share(
      sessions.reduce((sum, session) => sum + session.durationMinutes, 0),
      sessionCount,
    ),
    driftCompensationEffectiveness: roundTo(
      share(
        sessions.reduce((sum, session) => sum + session.absRtpDrift, 0),
        sessionCount,
      ),
      4,
    ),
  }
}

function buildSummary(args: {
  sessions: readonly SessionResult[]
  rates: ReportRates
  stdDevPerSpin: number
  totalSpins: number
}): SimulationSummary {
  const { sessions, rates } = args
  const sessionCount = sessions.length
  return {
    totalSessions: sessionCount,
    totalSpins: args.totalSpins,
    avgSessionDuration: `${roundTo(rates.avgSessionDurationMinutes, 1)} min`,
    avgSessionDurationMinutes: roundTo(rates.avgSessionDurationMinutes, 2),
    cumulativeRtp: rates.cumulativeRtp,
    rtpStdDev: roundTo(sampleStdDev(sessions.map((session) => session.cumulativeRtp)), 4),
    rtpStdDevPerSpin: roundTo(args.stdDevPerSpin, 4),
    onboardingSuccessRate: roundTo(rates.onboardingSuccessRate, 4),
    avgReactivationsPerSession: roundTo(rates.avgReactivationsPerSession, 4),
    avgBalanceAtCooldown: rates.avgBalanceAtCooldown,
    sessionsReachedCooldown: sessions.filter((session) => session.reachedCooldown).length,
    ldwFrequency: roundTo(rates.ldwFrequency, 6),
    nearMissFrequency: roundTo(rates.nearMissFrequency, 6),
    driftCompensationEffectiveness: rates.driftCompensationEffectiveness,
    avgFinalBalanceRatio: roundTo(
      share(
        sessions.reduce((sum, session) => sum + session.balanceRatioAtEnd, 0),
        sessionCount,
      ),
      6,
    ),
    avgSpinsPerSession: roundTo(share(args.totalSpins, sessionCount), 2),
  }
}

/** Вход строки таблицы вердиктов: метрики прогона + пороги §13.4. */
interface VerdictContext {
  run: MonteCarloRun
  rates: ReportRates
  criteria: typeof SIMULATION_SUCCESS_CRITERIA
  stdDevPerSpin: number
  totalSpins: number
}

function cumulativeRtpVerdict(context: VerdictContext): VerdictRow {
  const { rates, criteria } = context
  // §13.4 для RTP задал провал ровно теми же границами, что и цель
  // («> 98 % или < 94 %»), поэтому вне полосы — сразу FAIL, без WARN.
  const verdict = gradeBand(rates.cumulativeRtp, {
    passLower: criteria.cumulativeRtpMin,
    passUpper: criteria.cumulativeRtpMax,
    failLower: criteria.cumulativeRtpMin,
    failUpper: criteria.cumulativeRtpMax,
  })
  return {
    metric: 'cumulativeRtp',
    value: rates.cumulativeRtp,
    target: `${criteria.cumulativeRtpMin}–${criteria.cumulativeRtpMax} % (${criteria.cumulativeRtpTarget}±${criteria.cumulativeRtpTolerance})`,
    verdict,
    reason: verdict === 'PASS' ? null : dispersionNote(context.stdDevPerSpin, context.totalSpins),
    tzRef: '§13.4',
  }
}

function onboardingVerdict(context: VerdictContext): VerdictRow {
  const { rates, criteria } = context
  return {
    metric: 'onboardingSuccessRate',
    value: roundTo(rates.onboardingSuccessRate, 4),
    target: `≥${criteria.onboardingSuccessRateMin} (провал <${criteria.onboardingSuccessRateFail})`,
    verdict: gradeBand(rates.onboardingSuccessRate, {
      passLower: criteria.onboardingSuccessRateMin,
      passUpper: 1,
      failLower: criteria.onboardingSuccessRateFail,
      failUpper: null,
    }),
    reason:
      rates.onboardingSuccessRate < criteria.onboardingSuccessRateFail
        ? 'Цель ONBOARDING (+25 % к депозиту, §4.2) на этом плече не достигается: без завышенной отдачи ONBOARDING-фазы средний RTP ниже 100 % математически значит снижение баланса.'
        : null,
    tzRef: '§13.4',
  }
}

function reactivationVerdict(context: VerdictContext): VerdictRow {
  const { rates, criteria, run } = context
  return {
    metric: 'avgReactivationsPerSession',
    value: roundTo(rates.avgReactivationsPerSession, 4),
    target: `<${criteria.reactivationRateMaxPerSession} (провал >${criteria.reactivationRateFail})`,
    verdict: gradeBand(rates.avgReactivationsPerSession, {
      passLower: 0,
      passUpper: criteria.reactivationRateMaxPerSession,
      failLower: null,
      failUpper: criteria.reactivationRateFail,
    }),
    reason: mechanicReason(run.engineName, 'реактивацию (§4.3)'),
    tzRef: '§13.4',
  }
}

function cooldownVerdict(context: VerdictContext): VerdictRow {
  const { rates, criteria } = context
  return {
    metric: 'avgBalanceAtCooldown',
    value: rates.avgBalanceAtCooldown,
    target: `<${criteria.avgBalanceAtCooldownMaxRatio} (провал >${criteria.avgBalanceAtCooldownFailRatio}) от депозита`,
    verdict:
      rates.avgBalanceAtCooldown === null
        ? 'NOT_MEASURABLE'
        : gradeBand(rates.avgBalanceAtCooldown, {
            passLower: 0,
            passUpper: criteria.avgBalanceAtCooldownMaxRatio,
            failLower: null,
            failUpper: criteria.avgBalanceAtCooldownFailRatio,
          }),
    reason:
      rates.avgBalanceAtCooldown === null
        ? 'Ни одна сессия не дошла до COOLDOWN (§5.2: reactivationCount >= MAX_REACTIVATIONS) — метрику нечем измерить на этом плече.'
        : null,
    tzRef: '§13.4',
  }
}

function ldwVerdict(context: VerdictContext): VerdictRow {
  const { rates, criteria, run } = context
  const failLow = roundTo(
    criteria.ldwFrequencyTarget - FAIL_BOUND_MULTIPLIER * criteria.ldwFrequencyTolerance,
    6,
  )
  const failHigh = roundTo(
    criteria.ldwFrequencyTarget + FAIL_BOUND_MULTIPLIER * criteria.ldwFrequencyTolerance,
    6,
  )
  return {
    metric: 'ldwFrequency',
    value: roundTo(rates.ldwFrequency, 6),
    target: `${criteria.ldwFrequencyTarget}±${criteria.ldwFrequencyTolerance} (провал <${failLow} или >${failHigh})`,
    verdict: gradeBand(rates.ldwFrequency, {
      passLower: criteria.ldwFrequencyTarget - criteria.ldwFrequencyTolerance,
      passUpper: criteria.ldwFrequencyTarget + criteria.ldwFrequencyTolerance,
      failLower: failLow,
      failUpper: failHigh,
    }),
    reason: mechanicReason(run.engineName, 'LDW'),
    tzRef: '§13.4',
  }
}

function nearMissVerdict(context: VerdictContext): VerdictRow {
  const { rates, criteria, run } = context
  const failLow = roundTo(
    criteria.nearMissFrequencyTarget - FAIL_BOUND_MULTIPLIER * criteria.nearMissFrequencyTolerance,
    6,
  )
  const failHigh = roundTo(
    criteria.nearMissFrequencyTarget + FAIL_BOUND_MULTIPLIER * criteria.nearMissFrequencyTolerance,
    6,
  )
  return {
    metric: 'nearMissFrequency',
    value: roundTo(rates.nearMissFrequency, 6),
    target: `${criteria.nearMissFrequencyTarget}±${criteria.nearMissFrequencyTolerance} (провал <${failLow} или >${failHigh})`,
    verdict: gradeBand(rates.nearMissFrequency, {
      passLower: criteria.nearMissFrequencyTarget - criteria.nearMissFrequencyTolerance,
      passUpper: criteria.nearMissFrequencyTarget + criteria.nearMissFrequencyTolerance,
      failLower: failLow,
      failUpper: failHigh,
    }),
    reason: mechanicReason(run.engineName, 'Near-Miss'),
    tzRef: '§13.4',
  }
}

function driftVerdict(context: VerdictContext): VerdictRow {
  const { rates, criteria } = context
  return {
    metric: 'driftCompensationEffectiveness',
    value: rates.driftCompensationEffectiveness,
    target: `<${criteria.driftCompensationMaxPercent} п.п. (провал >${criteria.driftCompensationFailPercent})`,
    verdict: gradeBand(rates.driftCompensationEffectiveness, {
      passLower: 0,
      passUpper: criteria.driftCompensationMaxPercent,
      failLower: null,
      failUpper: criteria.driftCompensationFailPercent,
      strictUpper: true,
    }),
    reason:
      rates.driftCompensationEffectiveness > criteria.driftCompensationMaxPercent
        ? `Средний |rtpDrift| (§3.1) по сессиям. Компенсация дрейфа §7.1 гасит его только на плече engagement; здесь это чистая дисперсия таблицы. ${dispersionNote(context.stdDevPerSpin, context.totalSpins)}`
        : null,
    tzRef: '§13.4',
  }
}

function buildVerdicts(context: VerdictContext): VerdictRow[] {
  return [
    cumulativeRtpVerdict(context),
    onboardingVerdict(context),
    reactivationVerdict(context),
    cooldownVerdict(context),
    ldwVerdict(context),
    nearMissVerdict(context),
    driftVerdict(context),
  ]
}

/**
 * Отчёт §13.5 + таблица вердиктов §13.4.
 *
 * Все пороги берутся только из SIMULATION_SUCCESS_CRITERIA: PASS — значение в
 * целевом диапазоне, FAIL — за границей провала, WARN — между (ТЗ развела
 * «цель» и «критерий провала» двумя разными числами), NOT_MEASURABLE — метрику
 * нечем измерить на этом плече (баланс в COOLDOWN у контрольной группы, которая
 * в COOLDOWN не бывает). Параметры под вердикты не подгонялись.
 */
export function buildSimulationReport(input: {
  run: MonteCarloRun
  metrics?: EngagementMetricsResult
}): SimulationReport {
  const { run } = input
  const metricsResult = input.metrics ?? computeEngagementMetrics(run.sessions)
  const sessions = run.sessions
  const criteria = SIMULATION_SUCCESS_CRITERIA
  const totalSpins = countSpins(sessions)
  const stdDevPerSpin = analyticSpinStdDevPercent(run.game, run.game.baseRtp)
  const rates = computeReportRates(sessions, totalSpins)

  const summary = buildSummary({ sessions, rates, stdDevPerSpin, totalSpins })

  const verdicts = buildVerdicts({ run, rates, criteria, stdDevPerSpin, totalSpins })

  const counts = {
    pass: verdicts.filter((row) => row.verdict === 'PASS').length,
    warn: verdicts.filter((row) => row.verdict === 'WARN').length,
    fail: verdicts.filter((row) => row.verdict === 'FAIL').length,
    notMeasurable: verdicts.filter((row) => row.verdict === 'NOT_MEASURABLE').length,
  }

  return {
    engine: run.engineName,
    game: {
      externalGameId: run.game.externalGameId,
      displayName: run.game.displayName,
      baseRtp: run.game.baseRtp,
      paylines: run.game.paylines,
    },
    config: run.config,
    summary,
    distribution: {
      sessionDuration: distributionBlock(
        sessions.map((session) => session.durationMinutes),
        'min',
        MINUTES_FORMAT,
      ),
      finalBalance: distributionBlock(
        sessions.map((session) => session.balanceRatioAtEnd),
        '% deposit',
        DEPOSIT_SHARE_FORMAT,
      ),
    },
    verdicts,
    metrics: metricsResult.metrics,
    stopReasons: countStopReasons(sessions),
    // passed = все критерии PASS: §13.1 требует соответствия цели, а не «не провалили».
    passed: counts.pass === verdicts.length,
    counts,
    notes: buildNotes(run, stdDevPerSpin, totalSpins),
  }
}

function buildNotes(
  run: MonteCarloRun,
  stdDevPercentPerSpin: number,
  totalSpins: number,
): string[] {
  const onboardingRange = RTP_RANGES[EngagementPhase.ONBOARDING]
  const reactivationRange = RTP_RANGES[EngagementPhase.REACTIVATION]
  const notes: string[] = [
    `§13.4 требует накопленный RTP ${SIMULATION_SUCCESS_CRITERIA.cumulativeRtpMin}–${SIMULATION_SUCCESS_CRITERIA.cumulativeRtpMax} %, а §7.2/§5.3 дают фазовые диапазоны ONBOARDING ${onboardingRange.min}–${onboardingRange.max} % и REACTIVATION ${reactivationRange.min}–${reactivationRange.max} %: сессия, честно прошедшая цикл §4.1, не может уложиться в 94–98 %. Критерий противоречив сам по себе — параметры под него не подгонялись.`,
    dispersionNote(stdDevPercentPerSpin, totalSpins),
    '§13.2 задаёт betStrategy, но не задаёт сетку ставок: lab default — 1–5 % депозита на спин (fixed = 2 %, martingale = 1 % с удвоением до потолка 25 %), минимальная ставка 1. Константы живут в src/sim/session.ts.',
    '§13.2 не задаёт темп спинов: lab default — пять профилей интервалов с весами (быстрый 1,5–5 c / 54,5 %, обычный 5–15 c / 30 %, медленный 15–45 c / 10 %, пауза после проигрыша 30–180 c / 5 %, «ушёл» 30–33 мин / 0,5 %), все через переданный random. Редепозит из §4.1 (этап 4) не моделируется.',
    'avgSessionSpins трактуется как лимит спинов сессии: разброс длин дают остановки по балансу (§4.1) и по терминальным фазам COOLDOWN/DORMANT (§5.1), а не джиттер лимита.',
    'Денежные значения — строки MoneyAmount (8 знаков, правило «деньги» из AGENTS.md), статистика (RTP, доли, квантили) — числа: RTP-процент это метрика, а не баланс.',
    'SessionResult объявлен в src/sim/session.ts, а не в src/domain/types.ts: types.ts заморожен, а §11.1 и §13.4 просят счётчики, которых в EngagementState нет (доли фаз, цель onboarding, причина остановки).',
    'Цель ONBOARDING (§4.2) меряется по пику баланса: peakBalance >= initialDeposit * onboardingTargetRatio = +25 % (то же число стоит гардом ONBOARDING→RETENTION в §5.2).',
    '§13.5 показывает driftCompensationEffectiveness долей (0.015), а §13.4 задаёт порог в процентах (2 %) — отчёт отдаёт процентные пункты, чтобы сравнивать с SIMULATION_SUCCESS_CRITERIA без пересчёта.',
    'Границы провала LDW (15–35 %) и Near-Miss (5–25 %) §13.4 в SIMULATION_SUCCESS_CRITERIA отдельными полями не заданы: восстановлены как цель ± 2*допуск.',
  ]
  if (run.engineName === 'baseline') {
    notes.push(
      'Плечо baseline — контрольная группа §12.2: в ней нет §5.2 (FSM фаз), §6.1 (Engagement Score), §7 (адаптивный RTP), §8.1 (LDW), §8.2 (Near-Miss) и §4.3 (реактивация). Поэтому engagement_phase_distribution = 100 % ONBOARDING, engagement_score_avg = стартовые 50, LDW/Near-Miss/реактивации = 0, а COOLDOWN недостижим: вердикты NOT_MEASURABLE и тривиальные PASS на этом плече про механики ничего не говорят.',
    )
  }
  return notes
}
