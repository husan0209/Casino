/**
 * ТЗ ч.9 §6.2 — поведенческие сигналы игрока.
 *
 * Сигналы считаются из кольцевых буферов состояния и решают две вещи:
 * поправку к RTP (§7.1 шаг 3) и переходы FSM (§5.2). Псевдокод ТЗ использует
 * `parseFloat` и «текущее время» — здесь окно считается от последнего
 * известного спина, иначе на бэкенде без активности сигналы «стареют» и
 * движок начинает штрафовать игрока за паузу в кофейне.
 */
import { Decimal } from 'decimal.js'

import type { MoneyAmount } from '@casino/shared-types'

import { BALANCE_THRESHOLDS } from './engagement-config'
import {
  balanceRatioOf,
  recentSpins,
  type EngagementState,
  type BehaviorSpinRecord,
} from './engagement-state.vo'

export interface PlayerBehaviorSignals {
  /** §6.2 — средний интервал между последними спинами, мс. */
  readonly avgTimeBetweenSpins: number
  readonly spinsInLastMinute: number
  readonly spinsInLast5Minutes: number
  /** MoneyAmount: средняя ставка считается через Decimal, не через parseFloat. */
  readonly avgBetSize: MoneyAmount
  readonly betTrend: 'increasing' | 'stable' | 'decreasing'
  readonly balanceRatio: number
  readonly winLossRatio: number
  readonly lastWinAmount: MoneyAmount
  readonly maxWinInSession: MoneyAmount
  /** §6.2 — игрок урезает ставки. */
  readonly decreasingBetCount: boolean
  /** §6.2 — пауза >30 сек после проигрыша. */
  readonly longPauseAfterLoss: boolean
  readonly balanceNearZero: boolean
  readonly rapidClicking: boolean
  readonly slowClicking: boolean
}

const WINDOW_SPINS = 10
const MINUTE_MS = 60_000
const FIVE_MINUTES_MS = 300_000

function avgInterval(spins: readonly BehaviorSpinRecord[]): number {
  if (spins.length < 2) {
    return 0
  }
  // Сумма миллисекунд между спинами, не деньги — переменная названа sumMs,
  // чтобы не попасть под правило «money-переменные только строками».
  let sumMs = 0
  for (let i = 1; i < spins.length; i++) {
    sumMs += (spins[i]?.at ?? 0) - (spins[i - 1]?.at ?? 0)
  }
  return sumMs / (spins.length - 1)
}

function avgBet(spins: readonly BehaviorSpinRecord[]): Decimal {
  if (spins.length === 0) {
    return new Decimal(0)
  }
  const sum = spins.reduce((runningTotal, record) => runningTotal.plus(record.bet), new Decimal(0))
  return sum.div(spins.length)
}

function betTrend(recent: Decimal, overall: Decimal): 'increasing' | 'stable' | 'decreasing' {
  if (overall.lte(0)) {
    return 'stable'
  }
  const ratio = recent.div(overall).toNumber()
  if (ratio > 1.15) {
    return 'increasing'
  }
  if (ratio < 0.85) {
    return 'decreasing'
  }
  return 'stable'
}

export function computeBehaviorSignals(
  state: EngagementState,
  currentBalance: MoneyAmount,
  now: number = Date.now(),
): PlayerBehaviorSignals {
  const spins = state.behavior.spins
  const lastAt = spins[spins.length - 1]?.at ?? 0
  // Окно «живёт» от последнего спина: если игрок ушёл на час, поведение
  // не должно выглядеть как «медленный клик» (иначе RTP поедет вверх).
  const windowEnd = Math.max(now, lastAt)
  const windowStart = windowEnd - FIVE_MINUTES_MS

  const spinsInLastMinute = spins.filter((s) => s.at > windowEnd - MINUTE_MS).length
  const spinsInLast5Minutes = spins.filter((s) => s.at > windowStart).length

  const recent = recentSpins(state, WINDOW_SPINS)
  const overallBets = avgBet(spins)
  const recentBets = avgBet(recent)
  const trend = betTrend(recentBets, overallBets)

  const lastRecord = spins[spins.length - 1]
  const lastWasLoss = lastRecord !== undefined && !lastRecord.isWin
  const idleAfterLast = lastAt === 0 ? 0 : windowEnd - lastAt
  // Пауза — это тишина ВНУТРИ окна активности. За окном (§5.2, 30 мин) игрок
  // отсутствует, и «медленный клик» там означал бы наградную надбавку к RTP
  // за то, что человек не играл.
  const playerPresent = idleAfterLast <= BALANCE_THRESHOLDS.inactivityMs
  const longPauseAfterLoss =
    playerPresent && lastWasLoss && idleAfterLast > BALANCE_THRESHOLDS.longPauseAfterLossMs

  const wins = spins.filter((s) => s.isWin).length
  const winLossRatio = spins.length === 0 ? 0 : wins / spins.length
  const ratio = balanceRatioOf(state, currentBalance)

  return {
    avgTimeBetweenSpins: avgInterval(recent),
    spinsInLastMinute,
    spinsInLast5Minutes,
    avgBetSize: overallBets.toFixed(8),
    betTrend: trend,
    balanceRatio: ratio,
    winLossRatio,
    lastWinAmount: state.lastWinAmount,
    maxWinInSession: state.maxWinInSession,
    // §6.2: тренд вниз + падение частоты спинов — «уходит тихо».
    decreasingBetCount: trend === 'decreasing' && spinsInLast5Minutes < spinsInLastMinute * 2.5,
    longPauseAfterLoss,
    balanceNearZero: ratio < BALANCE_THRESHOLDS.nearZeroRatio,
    rapidClicking: spinsInLastMinute > BALANCE_THRESHOLDS.rapidClickingSpinsPerMin,
    slowClicking:
      spins.length > 0 &&
      playerPresent &&
      spinsInLast5Minutes < BALANCE_THRESHOLDS.slowClickingSpinsIn5Min,
  }
}

/**
 * §7.1 шаг 3 / §6.3 — поправка к RTP за поведение.
 * Знак: уходящего игрока тянем вверх («удерживаем»), азартного — вниз («сушим»).
 */
export function calculateBehaviorModifier(signals: PlayerBehaviorSignals): number {
  let modifier = 0
  if (signals.rapidClicking) {
    modifier -= 2
  }
  if (signals.betTrend === 'increasing') {
    modifier -= 1
  }
  if (signals.slowClicking) {
    modifier += 3
  }
  if (signals.decreasingBetCount) {
    modifier += 2
  }
  if (signals.longPauseAfterLoss) {
    modifier += 2
  }
  return modifier
}

/** Признаки, по которым §5.2 переводит RETENTION в RISK. */
export function hasChurnRisk(signals: PlayerBehaviorSignals): boolean {
  return (
    signals.longPauseAfterLoss ||
    signals.decreasingBetCount ||
    signals.avgTimeBetweenSpins > BALANCE_THRESHOLDS.slowAvgIntervalMs
  )
}
