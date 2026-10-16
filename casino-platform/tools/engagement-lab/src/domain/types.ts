/**
 * Контракт лаборатории Части 9. freeze: менять только вместе со всеми
 * реализациями — на этом типе держатся все модули каталога src/.
 */
import type { MoneyAmount } from '@casino/shared-types'

import { type EngagementPhase } from './engagement-phase'

import type {
  HouseSlotPayoutModel,
  TigerIconDoc,
  TigerSpinRow,
} from '../../../../apps/api/src/modules/casino/domain/house-slot-game'

export type { MoneyAmount }

/** Математическое ожидание одного спина, выраженное в долях ставки. */
export type PayoutMultiplier = number

/** Источник случайности: равномерный [0,1). */
export type RandomFn = () => number

/** Игра, на которой крутится симуляция: срез HouseSlotGameConfig без DI. */
export interface LabGame {
  externalGameId: string
  displayName: string
  payoutModel: HouseSlotPayoutModel
  /** Заявленный RTP игры в процентах, строка (правило G20). */
  baseRtp: MoneyAmount
  winRows: readonly TigerSpinRow[]
  loseRows: readonly TigerSpinRow[]
  paytable: TigerIconDoc
  /** Число линий, которые клиент ставит на спин: калибрует RTP как в бою. */
  paylines: number
}

/**
 * Состояние вовлечения. Поля повторяют §3.1 tz-part-9, но живут в памяти:
 * к БД лаборатория не обращается и денежный путь не трогает.
 */
export interface EngagementState {
  userId: string
  gameId: string
  sessionId: string

  engagementScore: number
  engagementPhase: EngagementPhase

  totalSpins: number
  totalWins: number
  totalLosses: number
  consecutiveLosses: number
  consecutiveWins: number

  initialDeposit: MoneyAmount
  peakBalance: MoneyAmount
  reactivationCount: number

  /** Ring buffers: последние RING_BUFFER_SIZE значений (§3.1). */
  spinTimestamps: number[]
  betAmounts: MoneyAmount[]

  totalBetAmount: MoneyAmount
  totalWinAmount: MoneyAmount
  cumulativeRtp: MoneyAmount
  rtpDrift: MoneyAmount

  sessionStartedAt: Date
  lastActivityAt: Date
  phaseChangedAt: Date
  lastReactivationAt: Date | null

  /** RTP, действовавший на прошлом спине: вход для сглаживания (§7.3). */
  appliedRtp: MoneyAmount

  counters: EngagementCounters

  /** Баланс на момент последнего спина — только для решения движка. */
  currentBalance: MoneyAmount
}

/**
 * Счётчики, которые ТЗ использует в алгоритмах (§4.3, §6.2, §9.1), но не
 * описала в колонках таблицы. Здесь они модельные; в проде попали бы в
 * metadata JSONB.
 */
export interface EngagementCounters {
  ldwCount: number
  nearMissCount: number
  lastLdwSpin: number
  lastReactivationSpin: number
  spinsSinceReactivation: number
  lastWinAmount: MoneyAmount
  maxWinInSession: MoneyAmount
  reactivationTriggered: boolean
  lastOutcomeWasLoss: boolean
  lastRtpAdjustment: MoneyAmount
}

/** Поведенческие сигналы, вычисленные из ring buffers (§6.2). */
export interface PlayerBehaviorSignals {
  avgTimeBetweenSpins: number
  spinsInLastMinute: number
  spinsInLast5Minutes: number
  avgBetSize: MoneyAmount
  betTrend: 'increasing' | 'stable' | 'decreasing'
  balanceRatio: number
  winLossRatio: number
  lastWinAmount: MoneyAmount
  maxWinInSession: MoneyAmount
  decreasingBetCount: boolean
  longPauseAfterLoss: boolean
  balanceNearZero: boolean
  rapidClicking: boolean
  slowClicking: boolean
}

/** Один спин, пришедший из симулятора (§9.1 шаг 1). */
export interface SpinRequest {
  betTotal: MoneyAmount
  paylines: number
  balanceBefore: MoneyAmount
  spinAt: Date
}

/** §4.3: решение о точке реактивации. */
export interface ReactivationDecision {
  trigger: boolean
  targetBalance: MoneyAmount | null
  /** Сколько нужно доначислить, чтобы довести баланс до targetBalance. */
  credit: MoneyAmount | null
}

/** §8.2: выбранный near-miss исход с именем сработавшего паттерна. */
export interface NearMissSelection {
  row: TigerSpinRow
  pattern: string
}

/** Решение движка до розыгрыша (§9.1 шаги 2–4). */
export interface SpinPlan {
  /** baseline (контрольная группа §12.2) сигналы не считает — там null. */
  behaviorSignals: PlayerBehaviorSignals | null
  scoreBefore: number
  phaseBefore: EngagementPhase
  targetRtp: MoneyAmount
  rtpDriftCompensation: MoneyAmount
  reactivationTrigger: boolean
  reactivationTargetBalance: MoneyAmount | null
  ldwRequested: boolean
  nearMissRequested: boolean
}

/** Итог розыгрыша с учётом LDW/Near-Miss (§9.1 шаги 5–7). */
export interface SpinOutcome {
  row: TigerSpinRow
  payoutMultiplier: PayoutMultiplier
  winTotal: MoneyAmount
  isWin: boolean
  isLdw: boolean
  isNearMiss: boolean
  nearMissPattern: string | null
  ldwReplaced: boolean
  nearMissReplaced: boolean
}

/** Полный результат спина: новое состояние + всё, что замерит симулятор. */
export interface SpinResult {
  state: EngagementState
  plan: SpinPlan
  outcome: SpinOutcome
  phaseAfter: EngagementPhase
  scoreAfter: number
  reactivationCredit: MoneyAmount | null
  balanceAfter: MoneyAmount
}

/**
 * Движок спина. Две реализации: baseline (контрольная группа §12.2, без
 * механик) и engagement (полный цикл §9.1).
 */
export interface SpinEngine {
  readonly name: string
  spin(args: {
    state: EngagementState
    game: LabGame
    request: SpinRequest
    random: RandomFn
  }): SpinResult
}

/** Событие аналитики: зеркало §3.3 engagement_events. */
export interface EngagementEventRecord {
  eventType: string
  eventData: Record<string, unknown>
  scoreBefore: number
  scoreAfter: number
  createdAt: Date
}
