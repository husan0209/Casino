import { Decimal } from 'decimal.js'

import { money } from '@casino/shared-utils'

import { BALANCE_CYCLE, TIMING, ZERO } from '../config'
import { EngagementPhase } from '../domain/engagement-phase'
import {
  type EngagementState,
  type LabGame,
  type MoneyAmount,
  type RandomFn,
  type SpinEngine,
  type SpinResult,
} from '../domain/types'
import { balanceRatio, createInitialState, roundPlaces } from '../engine/state-transitions'
import { randomInRange, randomIntBetween } from '../rng'

/** §13.2 betStrategy: три стратегии ставок из конфигурации симуляции. */
export type BetStrategy = 'fixed' | 'random' | 'martingale'

/** Причина остановки сессии: лимит спинов (§13.2) или терминальные фазы (§5.1). */
export type SessionStopReason = 'spin-limit' | 'balance-exhausted' | 'cooldown' | 'dormant'

/**
 * Параметры одной сессии (§13.2). Диапазон депозитов приходит из
 * SIMULATION_DEFAULTS, границы CLI может переопределить.
 */
export interface SessionParams {
  depositMin: number
  depositMax: number
  maxSpins: number
  betStrategy: BetStrategy
  /**
   * Абсолютная ставка на каждый спин (§13.6 генерирует именно betSize, а не
   * долю депозита). Если задана — стратегия игнорируется и ставка фиксирована.
   */
  betTotalOverride?: MoneyAmount
}

/**
 * Итог одной смоделированной сессии.
 *
 * Тип живёт здесь, а не в src/domain/types.ts: контракт types.ts заморожен, а
 * §11.1 и §13.4 просят счётчики, которых в EngagementState нет (доли фаз,
 * средняя длительность, цель onboarding). Денежные поля — строки (MoneyAmount),
 * статистические моменты — числа: RTP в процентах это метрика, а не баланс.
 */
export interface SessionResult {
  sessionId: string
  userId: string
  gameId: string
  engineName: string
  betStrategy: BetStrategy

  initialDeposit: MoneyAmount
  finalBalance: MoneyAmount
  peakBalance: MoneyAmount
  balanceRatioAtEnd: number
  peakBalanceRatio: number

  totalSpins: number
  totalWins: number
  totalLosses: number
  hitRate: number
  requestedSpins: number
  stopReason: SessionStopReason

  durationMs: number
  durationMinutes: number
  avgTimeBetweenSpinsMs: number
  maxGapMs: number

  totalBetAmount: MoneyAmount
  totalWinAmount: MoneyAmount
  /** Накопленная отдача сессии в процентах: зеркало EngagementState.cumulativeRtp. */
  cumulativeRtp: number
  /** §3.1: |накопленный RTP − целевой| в процентных пунктах. */
  absRtpDrift: number
  /** Σ bet^2: нужен, чтобы нормировать разброс RTP по фактическим ставкам. */
  sumBetSquared: number

  ldwCount: number
  nearMissCount: number
  ldwFrequency: number
  nearMissFrequency: number
  reactivationCount: number
  reactivationCreditTotal: MoneyAmount
  reactivationLimitExceeded: boolean

  /** §4.2: пик баланса достиг цели ONBOARDING (+25 % — onboardingTargetRatio). */
  onboardingGoalReached: boolean
  /** §4.1: сессия прошла ONBOARDING -> RETENTION -> RISK -> REACTIVATION. */
  fullCycleCompleted: boolean
  reachedCooldown: boolean
  reachedDormant: boolean
  finalPhase: EngagementPhase
  phasesVisited: EngagementPhase[]
  /** Сколько спинов игралась каждая фаза (вход для engagement_phase_distribution §11.1). */
  phaseSpinCounts: Record<EngagementPhase, number>

  avgEngagementScore: number
  finalEngagementScore: number
  /** §11.1 rtp_adjustment_avg: среднее |applied RTP − base RTP| по спинам, в п.п. */
  rtpAdjustmentMeanAbsDeviation: number
  /** Максимальный сдвиг RTP за спин (§7.3 maxRtpChangePerSpin контролируется движком). */
  maxRtpChangePerSpin: number
  finalState: EngagementState
}

/**
 * §13.2 не задаёт сетку ставок — lab default: доля депозита на спин 1–5 %,
 * фиксированная стратегия берёт середину диапазона снизу (2 %), мартингейл
 * стартует с 1 % и удваивается до потолка 25 % депозита.
 */
const BET_RATIO_RANGE = { min: 0.01, max: 0.05 } as const
const FIXED_BET_RATIO = 0.02
const MARTINGALE_BASE_RATIO = 0.01
const MARTINGALE_MAX_RATIO = 0.25
/** Минимальная ставка, ниже которой спин уже не делается: спин окончен. */
const MIN_BET: MoneyAmount = '1'
/** Деньги симуляции живут в формате DECIMAL(20,8) — восемь знаков. */
const MONEY_PLACES = 8

/**
 * Интервал между спинами: поведенческим сигналам §6.2 нужен правдоподобный
 * темп, поэтому темп дискретный — пять профилей с фиксированными весами
 * (lab default; границы профилей взяты из TIMING и BEHAVIOR §5.3, §6.2).
 * Быстрый профиль даёт rapidClicking, медленный — slowClicking, пауза после
 * проигрыша — longPauseAfterLoss (§6.2), а «ушёл и вернулся» — неактивность
 * дольше dormantAfterMs, по которой FSM уходит в DORMANT (§5.2).
 */
const SPIN_PACE_WEIGHTS = {
  walkAway: 0.005,
  pauseAfterLoss: 0.05,
  slow: 0.1,
  normal: 0.3,
  fast: 0.545,
} as const
const SPIN_PACE_BOUNDS = {
  fast: { minMs: 1_500, maxMs: 5_000 },
  normal: { minMs: 5_000, maxMs: TIMING.slowSpinIntervalMs },
  slow: { minMs: TIMING.slowSpinIntervalMs, maxMs: 45_000 },
  pause: { minMs: TIMING.longPauseAfterLossMs, maxMs: 180_000 },
  // Профиль «ушёл из сессии»: ровно те >30 минут, по которым §5.2 ведёт в DORMANT.
  walkAway: { minMs: TIMING.dormantAfterMs, maxMs: TIMING.dormantAfterMs + 180_000 },
} as const

function sampleSpinIntervalMs(random: RandomFn, lastOutcomeWasLoss: boolean): number {
  const roll = random()
  if (roll < SPIN_PACE_WEIGHTS.walkAway) {
    return randomInRange(random, SPIN_PACE_BOUNDS.walkAway.minMs, SPIN_PACE_BOUNDS.walkAway.maxMs)
  }
  if (roll < SPIN_PACE_WEIGHTS.walkAway + SPIN_PACE_WEIGHTS.pauseAfterLoss) {
    // Пауза после проигрыша (§6.2): без проигрыша это просто медленный темп.
    if (lastOutcomeWasLoss) {
      return randomInRange(random, SPIN_PACE_BOUNDS.pause.minMs, SPIN_PACE_BOUNDS.pause.maxMs)
    }
    return randomInRange(random, SPIN_PACE_BOUNDS.normal.minMs, SPIN_PACE_BOUNDS.normal.maxMs)
  }
  const slowCut =
    SPIN_PACE_WEIGHTS.walkAway + SPIN_PACE_WEIGHTS.pauseAfterLoss + SPIN_PACE_WEIGHTS.slow
  if (roll < slowCut) {
    return randomInRange(random, SPIN_PACE_BOUNDS.slow.minMs, SPIN_PACE_BOUNDS.slow.maxMs)
  }
  if (roll < slowCut + SPIN_PACE_WEIGHTS.normal) {
    return randomInRange(random, SPIN_PACE_BOUNDS.normal.minMs, SPIN_PACE_BOUNDS.normal.maxMs)
  }
  return randomInRange(random, SPIN_PACE_BOUNDS.fast.minMs, SPIN_PACE_BOUNDS.fast.maxMs)
}

/** Доля депозита для следующего спина по стратегии §13.2. */
function betRatioOf(strategy: BetStrategy, martingaleStep: number, random: RandomFn): number {
  if (strategy === 'fixed') {
    return FIXED_BET_RATIO
  }
  if (strategy === 'random') {
    return randomInRange(random, BET_RATIO_RANGE.min, BET_RATIO_RANGE.max)
  }
  const doubled = MARTINGALE_BASE_RATIO * 2 ** Math.min(martingaleStep, 8)
  return Math.min(doubled, MARTINGALE_MAX_RATIO)
}

function emptyPhaseCounts(): Record<EngagementPhase, number> {
  return {
    [EngagementPhase.ONBOARDING]: 0,
    [EngagementPhase.RETENTION]: 0,
    [EngagementPhase.RISK]: 0,
    [EngagementPhase.REACTIVATION]: 0,
    [EngagementPhase.COOLDOWN]: 0,
    [EngagementPhase.DORMANT]: 0,
  }
}

/**
 * Одна сессия (§13.2, §13.1): депозит из диапазона, цикл спинов до лимита
 * спинов, до исчерпания баланса (§4.1 «пока игрок не исчерпает депозит») или
 * до терминальных фаз COOLDOWN / DORMANT (§5.1, §5.2, §18.3).
 *
 * Фаза, LDW, near-miss и реактивации — ответственность движка (§9.1): сессия
 * их не додумывает, а только считает по SpinResult. Поэтому на контрольной
 * группе (§12.2, baseline) реактиваций и манипуляций не будет вовсе — это
 * результат замера, а не баг симулятора.
 *
 * Весь источник случайности — переданный random: при одном и том же seed
 * сессия воспроизводится байт-в-байт.
 */
export function simulateSession(args: {
  engine: SpinEngine
  game: LabGame
  params: SessionParams
  random: RandomFn
  userId: string
  sessionId: string
  startedAt: Date
}): SessionResult {
  const { engine, game, params, random, userId, sessionId, startedAt } = args

  const initialDeposit = roundPlaces(
    String(randomIntBetween(random, params.depositMin, params.depositMax)),
    MONEY_PLACES,
  )
  const state = createInitialState({
    userId,
    gameId: game.externalGameId,
    sessionId,
    initialDeposit,
    startedAt,
  })
  const accumulator = createSessionAccumulator({ state, baseRtpNumber: Number(game.baseRtp) })

  runSpinLoop({ engine, game, params, random, accumulator })

  accumulator.phasesVisited.add(accumulator.state.engagementPhase)
  return buildSessionResult({ engine, params, accumulator })
}

/** Мутируемые счётчики прогона: цикл спинов обновляет их на каждом шаге. */
interface SessionAccumulator {
  state: EngagementState
  stopReason: SessionStopReason
  reactivationCreditTotal: MoneyAmount
  baseRtpNumber: number
  lastAppliedRtp: number
  sumAbsRtpAdjustment: number
  maxRtpChangePerSpin: number
  sumScoreAfter: number
  sumBetSquared: number
  gapSumMs: number
  gapCount: number
  maxGapMs: number
  nowMs: number
  phasesVisited: Set<EngagementPhase>
  phaseSpinCounts: Record<EngagementPhase, number>
}

function createSessionAccumulator(args: {
  state: EngagementState
  baseRtpNumber: number
}): SessionAccumulator {
  return {
    state: args.state,
    stopReason: 'spin-limit',
    reactivationCreditTotal: ZERO,
    baseRtpNumber: args.baseRtpNumber,
    lastAppliedRtp: args.baseRtpNumber,
    sumAbsRtpAdjustment: 0,
    maxRtpChangePerSpin: 0,
    sumScoreAfter: 0,
    sumBetSquared: 0,
    gapSumMs: 0,
    gapCount: 0,
    maxGapMs: 0,
    nowMs: args.state.sessionStartedAt.getTime(),
    phasesVisited: new Set<EngagementPhase>([EngagementPhase.ONBOARDING]),
    phaseSpinCounts: emptyPhaseCounts(),
  }
}

/** Ставка спина: стратегия §13.2 либо ва-банк в пределах баланса (§17 «деньги»). */
function resolveBet(args: {
  params: SessionParams
  state: EngagementState
  deposit: Decimal
  martingaleStep: number
  random: RandomFn
}): MoneyAmount {
  const desiredBet = args.params.betTotalOverride
    ? args.params.betTotalOverride
    : args.deposit
        .times(betRatioOf(args.params.betStrategy, args.martingaleStep, args.random))
        .toDecimalPlaces(MONEY_PLACES)
        .toString()
  return money.isGreaterThan(desiredBet, args.state.currentBalance)
    ? args.state.currentBalance
    : desiredBet
}

/** §5.1: терминальная фаза спина останавливает сессию. */
function terminalStopReasonOf(phase: EngagementPhase): SessionStopReason | null {
  if (phase === EngagementPhase.COOLDOWN) {
    return 'cooldown'
  }
  if (phase === EngagementPhase.DORMANT) {
    return 'dormant'
  }
  return null
}

/** Цикл §13.2: крутит спины, пока хватает баланса и не упёрлись в лимит спинов. */
function runSpinLoop(args: {
  engine: SpinEngine
  game: LabGame
  params: SessionParams
  random: RandomFn
  accumulator: SessionAccumulator
}): void {
  const { engine, game, params, random, accumulator } = args
  const depositDecimal = new Decimal(accumulator.state.initialDeposit)
  let martingaleStep = 0

  for (let spinIndex = 0; spinIndex < params.maxSpins; spinIndex++) {
    // §4.1: спин делается, пока баланса хватает хотя бы на минимальную ставку.
    if (!money.isGreaterOrEqual(accumulator.state.currentBalance, MIN_BET)) {
      accumulator.stopReason = 'balance-exhausted'
      return
    }

    const bet = resolveBet({
      params,
      state: accumulator.state,
      deposit: depositDecimal,
      martingaleStep,
      random,
    })
    if (!money.isPositive(bet)) {
      accumulator.stopReason = 'balance-exhausted'
      return
    }

    const result = engine.spin({
      state: accumulator.state,
      game,
      request: {
        betTotal: bet,
        paylines: game.paylines,
        balanceBefore: accumulator.state.currentBalance,
        spinAt: new Date(accumulator.nowMs),
      },
      random,
    })

    if (advanceSession({ accumulator, result, bet, spinIndex, params, random })) {
      return
    }
    martingaleStep = result.outcome.isWin ? 0 : martingaleStep + 1
  }
}

/**
 * Учёт состоявшегося спина: RTP-дрейф (§3.1), счётчики §11.1, интервал до
 * следующего спина. true — сессия остановлена терминальной фазой (§5.1).
 */
function advanceSession(args: {
  accumulator: SessionAccumulator
  result: SpinResult
  bet: MoneyAmount
  spinIndex: number
  params: SessionParams
  random: RandomFn
}): boolean {
  const { accumulator, result } = args
  const appliedRtp = Number(result.plan.targetRtp)
  accumulator.sumAbsRtpAdjustment += Math.abs(appliedRtp - accumulator.baseRtpNumber)
  accumulator.maxRtpChangePerSpin = Math.max(
    accumulator.maxRtpChangePerSpin,
    Math.abs(appliedRtp - accumulator.lastAppliedRtp),
  )
  accumulator.lastAppliedRtp = appliedRtp

  accumulator.sumScoreAfter += result.scoreAfter
  accumulator.sumBetSquared += new Decimal(args.bet).pow(2).toNumber()
  accumulator.phaseSpinCounts[result.plan.phaseBefore] += 1
  accumulator.phasesVisited.add(result.plan.phaseBefore)
  accumulator.phasesVisited.add(result.phaseAfter)

  accumulator.state = result.state
  accumulator.reactivationCreditTotal = money.add(
    accumulator.reactivationCreditTotal,
    result.reactivationCredit ?? ZERO,
  )

  const terminalStop = terminalStopReasonOf(result.phaseAfter)
  if (terminalStop) {
    accumulator.stopReason = terminalStop
    return true
  }

  if (args.spinIndex < args.params.maxSpins - 1) {
    const gapMs = sampleSpinIntervalMs(args.random, !result.outcome.isWin)
    accumulator.gapSumMs += gapMs
    accumulator.gapCount += 1
    accumulator.maxGapMs = Math.max(accumulator.maxGapMs, gapMs)
    accumulator.nowMs += gapMs
  }
  return false
}

/** §4.1: сессия прошла ONBOARDING -> RETENTION -> RISK -> REACTIVATION. */
function hasCompletedFullCycle(phasesVisited: ReadonlySet<EngagementPhase>): boolean {
  return (
    phasesVisited.has(EngagementPhase.ONBOARDING) &&
    phasesVisited.has(EngagementPhase.RETENTION) &&
    phasesVisited.has(EngagementPhase.RISK) &&
    phasesVisited.has(EngagementPhase.REACTIVATION)
  )
}

/** Тайминги сессии: длительность и интервалы между спинами. */
function timingFieldsOf(accumulator: SessionAccumulator): {
  durationMs: number
  durationMinutes: number
  avgTimeBetweenSpinsMs: number
  maxGapMs: number
} {
  const durationMs = Math.max(0, accumulator.nowMs - accumulator.state.sessionStartedAt.getTime())
  return {
    durationMs,
    durationMinutes: durationMs / 60_000,
    avgTimeBetweenSpinsMs:
      accumulator.gapCount === 0 ? 0 : accumulator.gapSumMs / accumulator.gapCount,
    maxGapMs: accumulator.maxGapMs,
  }
}

/** Итог сессии (§13.5): проекция финального состояния и аккумуляторов. */
function buildSessionResult(args: {
  engine: SpinEngine
  params: SessionParams
  accumulator: SessionAccumulator
}): SessionResult {
  const { engine, params, accumulator } = args
  const state = accumulator.state
  const initialDeposit = state.initialDeposit
  const totalSpins = state.totalSpins
  const timing = timingFieldsOf(accumulator)
  const fullCycleCompleted = hasCompletedFullCycle(accumulator.phasesVisited)

  return {
    sessionId: state.sessionId,
    userId: state.userId,
    gameId: state.gameId,
    engineName: engine.name,
    betStrategy: params.betStrategy,
    initialDeposit,
    finalBalance: state.currentBalance,
    peakBalance: state.peakBalance,
    balanceRatioAtEnd: balanceRatio(state.currentBalance, initialDeposit),
    peakBalanceRatio: balanceRatio(state.peakBalance, initialDeposit),
    totalSpins,
    totalWins: state.totalWins,
    totalLosses: state.totalLosses,
    hitRate: totalSpins === 0 ? 0 : state.totalWins / totalSpins,
    requestedSpins: params.maxSpins,
    stopReason: accumulator.stopReason,
    ...timing,
    totalBetAmount: state.totalBetAmount,
    totalWinAmount: state.totalWinAmount,
    cumulativeRtp: Number(state.cumulativeRtp),
    absRtpDrift: Math.abs(Number(state.rtpDrift)),
    sumBetSquared: accumulator.sumBetSquared,
    ldwCount: state.counters.ldwCount,
    nearMissCount: state.counters.nearMissCount,
    ldwFrequency: totalSpins === 0 ? 0 : state.counters.ldwCount / totalSpins,
    nearMissFrequency: totalSpins === 0 ? 0 : state.counters.nearMissCount / totalSpins,
    reactivationCount: state.reactivationCount,
    reactivationCreditTotal: accumulator.reactivationCreditTotal,
    reactivationLimitExceeded: state.reactivationCount > BALANCE_CYCLE.maxReactivations,
    onboardingGoalReached:
      balanceRatio(state.peakBalance, initialDeposit) >= BALANCE_CYCLE.onboardingTargetRatio,
    fullCycleCompleted,
    reachedCooldown: state.engagementPhase === EngagementPhase.COOLDOWN,
    reachedDormant: state.engagementPhase === EngagementPhase.DORMANT,
    finalPhase: state.engagementPhase,
    phasesVisited: [...accumulator.phasesVisited],
    phaseSpinCounts: accumulator.phaseSpinCounts,
    avgEngagementScore:
      totalSpins === 0 ? state.engagementScore : accumulator.sumScoreAfter / totalSpins,
    finalEngagementScore: state.engagementScore,
    rtpAdjustmentMeanAbsDeviation:
      totalSpins === 0 ? 0 : accumulator.sumAbsRtpAdjustment / totalSpins,
    maxRtpChangePerSpin: accumulator.maxRtpChangePerSpin,
    finalState: state,
  }
}
