import { Decimal } from 'decimal.js'

import { money } from '@casino/shared-utils'

import { RING_BUFFER_SIZE, ZERO } from '../config'
import { EngagementPhase } from '../domain/engagement-phase'
import { type EngagementState, type EngagementCounters, type MoneyAmount } from '../domain/types'

/** Чтоledger-часть спина обязана сообщить после розыгрыша. */
export interface SpinLedger {
  betTotal: MoneyAmount
  winTotal: MoneyAmount
  balanceAfter: MoneyAmount
  spinAt: Date
  isWin: boolean
  isLdw: boolean
  isNearMiss: boolean
  /** RTP, реально действовавший на этом спине: вход для drift и сглаживания. */
  targetRtp: MoneyAmount
}

/** §3.1: состояние на первом спине новой сессии. */
export function createInitialState(args: {
  userId: string
  gameId: string
  sessionId: string
  initialDeposit: MoneyAmount
  startedAt: Date
}): EngagementState {
  const counters: EngagementCounters = {
    ldwCount: 0,
    nearMissCount: 0,
    lastLdwSpin: 0,
    lastReactivationSpin: 0,
    spinsSinceReactivation: Number.MAX_SAFE_INTEGER,
    lastWinAmount: ZERO,
    maxWinInSession: ZERO,
    reactivationTriggered: false,
    lastOutcomeWasLoss: false,
    lastRtpAdjustment: ZERO,
  }
  return {
    userId: args.userId,
    gameId: args.gameId,
    sessionId: args.sessionId,
    engagementScore: 50,
    engagementPhase: EngagementPhase.ONBOARDING,
    totalSpins: 0,
    totalWins: 0,
    totalLosses: 0,
    consecutiveLosses: 0,
    consecutiveWins: 0,
    initialDeposit: args.initialDeposit,
    peakBalance: args.initialDeposit,
    reactivationCount: 0,
    spinTimestamps: [],
    betAmounts: [],
    totalBetAmount: ZERO,
    totalWinAmount: ZERO,
    cumulativeRtp: ZERO,
    rtpDrift: ZERO,
    sessionStartedAt: args.startedAt,
    lastActivityAt: args.startedAt,
    phaseChangedAt: args.startedAt,
    lastReactivationAt: null,
    appliedRtp: ZERO,
    counters,
    currentBalance: args.initialDeposit,
  }
}

/**
 * §3.1 updateCumulativeRtp: накопленная отдача и отклонение от целевого RTP.
 * Округление до 6 знаков — как у колонок cumulative_rtp и rtp_drift.
 */
export function updateCumulativeRtp(args: {
  state: EngagementState
  betTotal: MoneyAmount
  winTotal: MoneyAmount
  targetRtp: MoneyAmount
}): EngagementState {
  const { state, betTotal, winTotal, targetRtp } = args
  const totalBetAmount = money.add(state.totalBetAmount, betTotal)
  const totalWinAmount = money.add(state.totalWinAmount, winTotal)
  if (!money.isGreaterThan(totalBetAmount, ZERO)) {
    return { ...state, totalBetAmount, totalWinAmount }
  }
  const cumulativeRtp = roundPlaces(
    money.divide(money.multiply(totalWinAmount, '100'), totalBetAmount),
    6,
  )
  const rtpDrift = roundPlaces(money.subtract(cumulativeRtp, targetRtp), 3)
  return { ...state, totalBetAmount, totalWinAmount, cumulativeRtp, rtpDrift }
}

/**
 * §9.1 шаг 8: один спин -> новое состояние. Ничего не мутирует, возвращает
 * копию: на этом держатся параллельные прогоны симулятора.
 */
export function recordSpin(state: EngagementState, ledger: SpinLedger): EngagementState {
  const balanceAfter = ledger.balanceAfter
  const peakBalance = money.isGreaterThan(balanceAfter, state.peakBalance)
    ? balanceAfter
    : state.peakBalance

  const nextWithLedger: EngagementState = {
    ...state,
    totalSpins: state.totalSpins + 1,
    totalWins: ledger.isWin ? state.totalWins + 1 : state.totalWins,
    totalLosses: ledger.isWin ? state.totalLosses : state.totalLosses + 1,
    consecutiveWins: ledger.isWin ? state.consecutiveWins + 1 : 0,
    consecutiveLosses: ledger.isWin ? 0 : state.consecutiveLosses + 1,
    spinTimestamps: pushRing(state.spinTimestamps, ledger.spinAt.getTime()),
    betAmounts: pushRing(state.betAmounts, ledger.betTotal),
    peakBalance,
    lastActivityAt: ledger.spinAt,
    appliedRtp: ledger.targetRtp,
    currentBalance: balanceAfter,
  }

  const updated = updateCumulativeRtp({
    state: nextWithLedger,
    betTotal: ledger.betTotal,
    winTotal: ledger.winTotal,
    targetRtp: ledger.targetRtp,
  })

  return { ...updated, counters: updateCounters(state.counters, ledger, nextWithLedger.totalSpins) }
}

function updateCounters(
  previous: EngagementCounters,
  ledger: SpinLedger,
  spinIndex: number,
): EngagementCounters {
  return {
    ldwCount: ledger.isLdw ? previous.ldwCount + 1 : previous.ldwCount,
    nearMissCount: ledger.isNearMiss ? previous.nearMissCount + 1 : previous.nearMissCount,
    lastLdwSpin: ledger.isLdw ? spinIndex : previous.lastLdwSpin,
    lastReactivationSpin: previous.lastReactivationSpin,
    spinsSinceReactivation: previous.spinsSinceReactivation + 1,
    lastWinAmount: ledger.isWin ? ledger.winTotal : previous.lastWinAmount,
    maxWinInSession:
      ledger.isWin && money.isGreaterThan(ledger.winTotal, previous.maxWinInSession)
        ? ledger.winTotal
        : previous.maxWinInSession,
    reactivationTriggered: previous.reactivationTriggered,
    lastOutcomeWasLoss: !ledger.isWin,
    lastRtpAdjustment: ledger.targetRtp,
  }
}

/** §4.3 и §5.2: состояние после сработавшей реактивации. */
export function markReactivation(
  state: EngagementState,
  args: { at: Date; balanceAfter: MoneyAmount; targetRtp: MoneyAmount },
): EngagementState {
  return {
    ...state,
    engagementPhase: EngagementPhase.REACTIVATION,
    phaseChangedAt: args.at,
    lastReactivationAt: args.at,
    currentBalance: args.balanceAfter,
    peakBalance: money.isGreaterThan(args.balanceAfter, state.peakBalance)
      ? args.balanceAfter
      : state.peakBalance,
    reactivationCount: state.reactivationCount + 1,
    appliedRtp: args.targetRtp,
    counters: {
      ...state.counters,
      reactivationTriggered: true,
      lastReactivationSpin: state.totalSpins,
      spinsSinceReactivation: 0,
    },
  }
}

/** §5.1: переход фазы; timestamp двигается только при реальной смене. */
export function updatePhase(
  state: EngagementState,
  phase: EngagementPhase,
  changedAt: Date,
): EngagementState {
  if (state.engagementPhase === phase) {
    return state
  }
  return { ...state, engagementPhase: phase, phaseChangedAt: changedAt }
}

/** §3.1 pushToRingBuffer: держим последние RING_BUFFER_SIZE значений. */
export function pushRing<T>(buffer: readonly T[], item: T): T[] {
  const next = buffer.length >= RING_BUFFER_SIZE ? buffer.slice(-RING_BUFFER_SIZE + 1) : [...buffer]
  next.push(item)
  return next
}

export function balanceRatio(balance: MoneyAmount, initialDeposit: MoneyAmount): number {
  if (new Decimal(initialDeposit).isZero()) {
    return 0
  }
  return new Decimal(balance).div(initialDeposit).toNumber()
}

export function roundPlaces(value: MoneyAmount, places: number): MoneyAmount {
  return new Decimal(value).toDecimalPlaces(places).toString()
}
