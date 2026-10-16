import { Decimal } from 'decimal.js'

import { BEHAVIOR, TIMING } from '../config'
import { type EngagementState, type MoneyAmount, type PlayerBehaviorSignals } from './types'
import { balanceRatio } from '../engine/state-transitions'

/**
 * §6.2 «деcreasingBetCount» в ТЗ задан как betTrend==='decreasing' &&
 * spinsInLast5Minutes < spinsInLastMinute*5*0.5 — сравнение окна с окном,
 * правая часть растёт вместе с активностью и условие почти всегда ложно.
 * Здесь осмысленное правило: ставка падает И активность падает — последние
 * ставки ниже средних по сессии (betTrend==='decreasing') И средний интервал
 * между спинами в последнем окне длиннее, чем в окне перед ним.
 */

/** Средний интервал между соседними метками; 0 на буфере короче двух значений. */
function averageInterval(timestamps: readonly number[]): number {
  if (timestamps.length < 2) {
    return 0
  }
  let totalInterval = 0
  for (let index = 1; index < timestamps.length; index++) {
    totalInterval += (timestamps[index] ?? 0) - (timestamps[index - 1] ?? 0)
  }
  return totalInterval / (timestamps.length - 1)
}

/** Сколько меток попали в окно (cutoffMs, +∞). */
function countSpinsAfter(timestamps: readonly number[], cutoffMs: number): number {
  let spinsInWindow = 0
  for (const timestamp of timestamps) {
    if (timestamp > cutoffMs) {
      spinsInWindow += 1
    }
  }
  return spinsInWindow
}

/** Последние size значений кольцевого буфера. */
function lastWindow<T>(items: readonly T[], size: number): T[] {
  return items.slice(-size)
}

/** Окно, сразу предшествующее последним size значениям; пусто, если данных мало. */
function previousWindow(items: readonly number[], size: number): number[] {
  const previousEnd = items.length - size
  if (previousEnd <= 0) {
    return []
  }
  return items.slice(Math.max(0, previousEnd - size), previousEnd)
}

/** Среднее арифметическое ставок как Decimal; 0 на пустом буфере. */
function averageBet(bets: readonly MoneyAmount[]): Decimal {
  if (bets.length === 0) {
    return new Decimal(0)
  }
  const sum = bets.reduce((accumulator, bet) => accumulator.plus(bet), new Decimal(0))
  return sum.div(bets.length)
}

/**
 * §6.2: поведенческие сигналы из ring buffers. Единственный источник правды
 * для адаптивной волатильности (§6.3) и для FSM-гардов (§5.2).
 *
 * Замечание по входу: nowMs передаётся параметром, чтобы симуляция могла
 * проигрывать сессии на сжатой шкале времени и чтобы тесты были детерминированы.
 *
 * Все пороги берутся из экспортов src/config.ts (BEHAVIOR, TIMING); новых чисел
 * здесь не появляется. Пустые и одноэлементные буферы не дают ни NaN, ни
 * Infinity: деление guarded, balanceRatio() из state-transitions уже возвращает
 * 0 при нулевом initialDeposit.
 */
export function computeBehaviorSignals(
  state: EngagementState,
  nowMs: number,
): PlayerBehaviorSignals {
  const timestamps = state.spinTimestamps
  const bets = state.betAmounts

  // Окна частоты: последние минута и 5 минут относительно nowMs.
  const spinsInLastMinute = countSpinsAfter(timestamps, nowMs - TIMING.minuteMs)
  const spinsInLast5Minutes = countSpinsAfter(timestamps, nowMs - TIMING.fiveMinutesMs)

  // Среднее время между спинами по последнему окну (§6.2, последние N меток).
  const recentTimestamps = lastWindow(timestamps, BEHAVIOR.recentTimestampWindow)
  const avgTimeBetweenSpins = averageInterval(recentTimestamps)

  // rapidClicking: спинов за минуту строго больше порога (§6.2 >10/мин).
  const rapidClicking = spinsInLastMinute > BEHAVIOR.rapidClicksPerMinute

  // slowClicking: в пересчёте на 5-минутное окно спинов меньше, чем
  // slowClicksPerMinute * (окно/минута). Требование «был хотя бы один спин»
  // и «не в азарте» нужно, чтобы новая сессия с 0 спинов и всплеск быстрых
  // кликов не помечались потерей интереса.
  const slowRateInWindow = BEHAVIOR.slowClicksPerMinute * (TIMING.fiveMinutesMs / TIMING.minuteMs)
  const slowClicking =
    spinsInLast5Minutes >= 1 && spinsInLast5Minutes < slowRateInWindow && !rapidClicking

  // Тренд ставок: последние N со средним по всей сессии, пороги 1.15 / 0.85.
  const allBetsAverage = averageBet(bets)
  const recentBetsAverage = averageBet(lastWindow(bets, BEHAVIOR.recentBetsWindow))
  const betTrend = resolveBetTrend(recentBetsAverage, allBetsAverage)

  // decreasingBetCount: ставка падает И активность падает (см. комментарий выше).
  const recentInterval = averageInterval(recentTimestamps)
  const previousInterval = averageInterval(
    previousWindow(timestamps, BEHAVIOR.recentTimestampWindow),
  )
  const activityFalling = previousInterval > 0 && recentInterval > previousInterval
  const decreasingBetCount = betTrend === 'decreasing' && activityFalling

  // Долгая пауза после проигрыша: был проигрыш И последний спин дальше порога.
  const lastSpinTimestamp = timestamps.length > 0 ? (timestamps[timestamps.length - 1] ?? 0) : null
  const longPauseAfterLoss =
    state.counters.lastOutcomeWasLoss &&
    lastSpinTimestamp !== null &&
    nowMs - lastSpinTimestamp > TIMING.longPauseAfterLossMs

  const currentBalanceRatio = balanceRatio(state.currentBalance, state.initialDeposit)
  const balanceNearZero = isBalanceNearZero(state.currentBalance, state.initialDeposit)

  // winLossRatio = wins / (wins + losses); на нулевых счётчиках — 0, не NaN.
  const decidedSpins = state.totalWins + state.totalLosses
  const winLossRatio = decidedSpins > 0 ? state.totalWins / decidedSpins : 0

  return {
    avgTimeBetweenSpins,
    spinsInLastMinute,
    spinsInLast5Minutes,
    avgBetSize: allBetsAverage.toString(),
    betTrend,
    balanceRatio: currentBalanceRatio,
    winLossRatio,
    lastWinAmount: state.counters.lastWinAmount,
    maxWinInSession: state.counters.maxWinInSession,
    decreasingBetCount,
    longPauseAfterLoss,
    balanceNearZero,
    rapidClicking,
    slowClicking,
  }
}

/** Пороги 1.15 / 0.85 из BEHAVIOR; на пустом/нулевом буфере ставок — stable. */
function resolveBetTrend(
  recentBetsAverage: Decimal,
  allBetsAverage: Decimal,
): PlayerBehaviorSignals['betTrend'] {
  if (allBetsAverage.isZero()) {
    return 'stable'
  }
  const increasingThreshold = allBetsAverage.times(BEHAVIOR.betTrendIncreasingFactor)
  if (recentBetsAverage.greaterThan(increasingThreshold)) {
    return 'increasing'
  }
  const decreasingThreshold = allBetsAverage.times(BEHAVIOR.betTrendDecreasingFactor)
  if (recentBetsAverage.lessThan(decreasingThreshold)) {
    return 'decreasing'
  }
  return 'stable'
}

/**
 * balanceNearZero: currentBalance < initialDeposit * BEHAVIOR.balanceNearZeroRatio.
 * При нулевом initialDeposit порог равен 0 и знак «<» даёт false — ни NaN, ни
 * Infinity (в отличие от деления на депозит), правило §5.2 сохраняет смысл.
 */
function isBalanceNearZero(balance: MoneyAmount, initialDeposit: MoneyAmount): boolean {
  const nearZeroThreshold = new Decimal(initialDeposit).times(BEHAVIOR.balanceNearZeroRatio)
  return new Decimal(balance).lessThan(nearZeroThreshold)
}
