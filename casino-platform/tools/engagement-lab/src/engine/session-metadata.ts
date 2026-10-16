import { type EngagementPhase } from '../domain/engagement-phase'
import { type EngagementState, type MoneyAmount } from '../domain/types'

/**
 * §3.2: расширение `game_sessions.metadata`. В лаборатории ничего не пишется в
 * БД — это чистая проекция состояния вовлечения в JSONB-форму сессии.
 *
 * Имена полей — дословно §3.2. Единственное расхождение: §3.2 объявляет
 * `lastRtpAdjustment: number`, а тут MoneyAmount (Decimal string), потому что
 * правило №1 `casino-platform/agents.md` запрещает числа для денежных и
 * процентных величин, а весь lab хранит RTP именно строкой (§3.1: cumulativeRtp,
 * rtpDrift, appliedRtp).
 */
export interface GameSessionEngagementMetadata {
  engagement?: {
    score: number
    phase: EngagementPhase
    spinCount: number
    winCount: number
    ldwCount: number
    nearMissCount: number
    lastRtpAdjustment: MoneyAmount
    initialDeposit: MoneyAmount
    peakBalance: MoneyAmount
    reactivationTriggered: boolean
  }
}

/** §3.2: состояние вовлечения -> metadata активной сессии. */
export function buildSessionMetadata(state: EngagementState): GameSessionEngagementMetadata {
  return {
    engagement: {
      score: state.engagementScore,
      phase: state.engagementPhase,
      spinCount: state.totalSpins,
      winCount: state.totalWins,
      ldwCount: state.counters.ldwCount,
      nearMissCount: state.counters.nearMissCount,
      lastRtpAdjustment: state.counters.lastRtpAdjustment,
      initialDeposit: state.initialDeposit,
      peakBalance: state.peakBalance,
      reactivationTriggered: state.counters.reactivationTriggered,
    },
  }
}
