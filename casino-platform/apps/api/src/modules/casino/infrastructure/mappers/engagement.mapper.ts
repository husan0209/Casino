/**
 * ТЗ ч.9 §3.1 — маппинг состояния движка между доменом и строками Prisma.
 *
 * Наружу торчат две вещи: `toEngagementState` (строка БД → VO) и
 * `toEngagementStateWrite` (VO → данные upsert). Кольцевые буферы §6.2 и
 * снапшот §3.2 лежат в JSONB-колонках и разбираются здесь же, чтобы
 * Prisma-типы не протекали в домен.
 *
 * `last_reactivation_spin` в БД nullable: NULL означает «реактиваций ещё не
 * было», 0 — легальный номер спина (нумерация с нуля, §4.3). Конвертация
 * односторонняя и явная — домен и БД говорят на одном языке.
 */
import type { Currency } from '@casino/shared-types'

import { createEngagementState, isEngagementPhase } from '../../domain/engagement'

import type {
  BehaviorBuffers,
  BehaviorSpinRecord,
  EngagementPhase,
  EngagementSessionSnapshot,
  EngagementState,
} from '../../domain/engagement'
import type { Prisma } from '@prisma/client'

type StateRow = {
  userId: string
  gameId: string
  phase: string
  rtpDrift: unknown
  totalSpins: number
  totalBet: unknown
  totalWin: unknown
  lastWinAmount: unknown
  maxWinInSession: unknown
  ldwCount: number
  nearMissCount: number
  lastLdwSpin: number
  lastReactivationSpin: number | null
  reactivationCount: number
  currentBalance: unknown
  initialDeposit: unknown
  peakBalance: unknown
  behavior: unknown
  sessionMetadata: unknown
  lastEngagementSpinAt: Date | null
  lastSessionId: string | null
}

function asString(value: unknown): string {
  if (value === null || value === undefined) {
    return '0'
  }
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number') {
    return String(value)
  }
  // Prisma Decimal приходит объектом — приводим к строке на границе.
  return String(value)
}

function parseBuffers(value: unknown): BehaviorBuffers {
  if (!value || typeof value !== 'object') {
    return { spins: [] }
  }
  const raw = (value as { spins?: unknown }).spins
  if (!Array.isArray(raw)) {
    return { spins: [] }
  }
  const spins: BehaviorSpinRecord[] = raw.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return []
    }
    const record = item as Record<string, unknown>
    if (typeof record.at !== 'number') {
      return []
    }
    return [
      {
        at: record.at,
        bet: asString(record.bet),
        win: asString(record.win),
        isWin: record.isWin === true,
      },
    ]
  })
  return { spins }
}

function parseSnapshot(value: unknown): EngagementSessionSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const raw = value as Record<string, unknown>
  if (!isEngagementPhase(raw.phase)) {
    return null
  }
  return {
    phase: raw.phase,
    score: typeof raw.score === 'number' ? raw.score : 0,
    balanceRatio: typeof raw.balanceRatio === 'number' ? raw.balanceRatio : 0,
    cycleTargetBalance: asString(raw.cycleTargetBalance),
    cycleStep: typeof raw.cycleStep === 'string' ? raw.cycleStep : 'inactive',
    reactivationCount: typeof raw.reactivationCount === 'number' ? raw.reactivationCount : 0,
    peakBalance: raw.peakBalance === undefined ? '0' : asString(raw.peakBalance),
    lastUpdatedAt: typeof raw.lastUpdatedAt === 'number' ? raw.lastUpdatedAt : 0,
  }
}

export function toEngagementState(row: StateRow, currency: Currency): EngagementState {
  const phase: EngagementPhase = isEngagementPhase(row.phase) ? row.phase : 'onboarding'
  return {
    userId: row.userId,
    gameId: row.gameId,
    currency,
    phase,
    rtpDrift: asString(row.rtpDrift),
    totalSpins: row.totalSpins,
    totalBet: asString(row.totalBet),
    totalWin: asString(row.totalWin),
    lastWinAmount: asString(row.lastWinAmount),
    maxWinInSession: asString(row.maxWinInSession),
    ldwCount: row.ldwCount,
    nearMissCount: row.nearMissCount,
    lastLdwSpin: row.lastLdwSpin,
    reactivationCount: row.reactivationCount,
    lastReactivationSpin: row.lastReactivationSpin,
    initialDeposit: asString(row.initialDeposit),
    currentBalance: asString(row.currentBalance),
    peakBalance: asString(row.peakBalance),
    behavior: parseBuffers(row.behavior),
    sessionSnapshot: parseSnapshot(row.sessionMetadata),
    lastSpinAt: row.lastEngagementSpinAt,
    lastSessionId: row.lastSessionId,
  }
}

/** Данные upsert состояния. */
export function toEngagementStateWrite(args: {
  state: EngagementState
  currentBalance: string
  snapshot: EngagementSessionSnapshot | null
}): {
  phase: EngagementPhase
  rtpDrift: string
  totalSpins: number
  totalBet: string
  totalWin: string
  lastWinAmount: string
  maxWinInSession: string
  ldwCount: number
  nearMissCount: number
  lastLdwSpin: number
  lastReactivationSpin: number | null
  reactivationCount: number
  currentBalance: string
  initialDeposit: string
  peakBalance: string
  behavior: Prisma.InputJsonValue
  sessionMetadata: Prisma.InputJsonValue
  lastEngagementSpinAt: Date | null
  lastSessionId: string | null
} {
  const { state, currentBalance, snapshot } = args
  return {
    phase: state.phase,
    rtpDrift: state.rtpDrift,
    totalSpins: state.totalSpins,
    totalBet: state.totalBet,
    totalWin: state.totalWin,
    lastWinAmount: state.lastWinAmount,
    maxWinInSession: state.maxWinInSession,
    ldwCount: state.ldwCount,
    nearMissCount: state.nearMissCount,
    lastLdwSpin: state.lastLdwSpin,
    lastReactivationSpin: state.lastReactivationSpin,
    reactivationCount: state.reactivationCount,
    currentBalance,
    initialDeposit: state.initialDeposit,
    peakBalance: state.peakBalance,
    // Prisma.InputJsonValue не принимает readonly-типы домена напрямую:
    // приведение здесь единственное место, где JSONB-колонки покидают
    // типизированный домен, и форма объекта гарантирована конструктором.
    behavior: { spins: state.behavior.spins } as unknown as Prisma.InputJsonValue,
    sessionMetadata: (snapshot ?? {}) as Prisma.InputJsonValue,
    lastEngagementSpinAt: state.lastSpinAt,
    lastSessionId: state.lastSessionId,
  }
}

/** Начальное состояние для новой пары — общая точка с createEngagementState. */
export function newStateFor(args: {
  userId: string
  gameId: string
  currency: Currency
  initialDeposit: string
  currentBalance: string
}): EngagementState {
  return createEngagementState(args)
}
