/**
 * ТЗ ч.9 §6.2, §3.2, §11.3 — UC-ENG-06 TrackBehaviorUseCase.
 *
 * Единственная точка записи состояния движка: обновляет кольцевые буферы,
 * счётчики, фазу, дрейф RTP, пик баланса, снапшот сессии и журнал событий.
 * События пишутся здесь же, чтобы состояние и журнал не могли разойтись
 * из-за двух разных записей.
 *
 * Здесь же фиксируются решения, принятые на спине: фаза (§5.2 — решение FSM
 * обязано попасть в состояние, иначе RISK/REACTIVATION/COOLDOWN недостижимы),
 * кредит реактивации (§4.3 — счётчик и номер спина растут только когда кредит
 * реально выдан) и события механик (`rtp_adjusted`, `ldw_applied`,
 * `near_miss_applied` — их готовят use-cases, а пишет этот класс).
 */
import { Inject, Injectable } from '@nestjs/common'

import type { MoneyAmount } from '@casino/shared-types'

import {
  applySpinToState,
  type EngagementSessionSnapshot,
  type EngagementState,
} from '../../../domain/engagement'
import { ENGAGEMENT_CACHE } from '../../../domain/repositories/engagement-cache.port'
import {
  ENGAGEMENT_REPOSITORY,
  type EngagementEventInput,
  type EngagementEventType,
  type IEngagementRepository,
} from '../../../domain/repositories/engagement.repository'

/** Событие, подготовленное use-case (rtp/ldw/near-miss) и ещё не записанное. */
export interface PendingEngagementEvent {
  readonly eventType: EngagementEventType
  readonly payload: Record<string, unknown>
}

export interface TrackSpinInput {
  state: EngagementState
  bet: MoneyAmount
  win: MoneyAmount
  /** Баланс после спина (с учётом кредита реактивации, если он был). */
  currentBalance: MoneyAmount
  sessionId: string | null
  isLdw: boolean
  isNearMiss: boolean
  /** Плановый RTP фазы спина — цель дрейфа §7.1. */
  targetRtpPercent: number
  /** Фаза спина из FSM §5.2; она же сохраняется в состояние. */
  phase: EngagementState['phase']
  previousPhase: EngagementState['phase']
  score: number
  balanceRatio: number
  cycleTargetBalance: MoneyAmount
  cycleStep: string
  phaseReason: string
  /** §4.3 — кредит реактивации реально выдан игроку на этом спине. */
  reactivationTriggered: boolean
  reactivationCredit: MoneyAmount
  /** §12 — группа эксперимента для разметки событий; null — вне эксперимента. */
  experimentGroup: string | null
  /** События механик этого спина (rtp/ldw/near-miss). */
  pendingEvents: readonly PendingEngagementEvent[]
  at: number
}

export interface TrackSpinResult {
  readonly state: EngagementState
  readonly writtenEvents: number
}

@Injectable()
export class TrackBehaviorUseCase {
  constructor(
    @Inject(ENGAGEMENT_REPOSITORY) private readonly repo: IEngagementRepository,
    @Inject(ENGAGEMENT_CACHE)
    private readonly cache: {
      invalidate(userId: string, gameId: string): Promise<void>
    },
  ) {}

  async execute(input: TrackSpinInput): Promise<TrackSpinResult> {
    // §5.2/§7.1: фаза и дрейф — часть состояния; обновляем их вместе
    // со счётчиками, чтобы «сохранённый спин» был единственной правдой.
    const nextState = applySpinToState({
      state: input.state,
      bet: input.bet,
      win: input.win,
      currentBalance: input.currentBalance,
      at: input.at,
      isLdw: input.isLdw,
      isNearMiss: input.isNearMiss,
      nextPhase: input.phase,
      reactivationTriggered: input.reactivationTriggered,
      targetRtpPercent: input.targetRtpPercent,
      sessionId: input.sessionId,
    })

    // §3.2 снапшот пишется на смене фазы: чаще всего это 0–2 записи за сессию,
    // тогда как metadata на каждом спине упирается в write-амплитуду JSONB.
    const phaseChanged = nextState.phase !== input.previousPhase
    const snapshot: EngagementSessionSnapshot | null = phaseChanged
      ? {
          phase: nextState.phase,
          score: input.score,
          balanceRatio: input.balanceRatio,
          cycleTargetBalance: input.cycleTargetBalance,
          cycleStep: input.cycleStep,
          reactivationCount: nextState.reactivationCount,
          peakBalance: nextState.peakBalance,
          lastUpdatedAt: input.at,
        }
      : nextState.sessionSnapshot

    const events: EngagementEventInput[] = this.buildEvents({
      input,
      state: nextState,
      phaseChanged,
    })

    await this.repo.saveState({
      state: nextState,
      currentBalance: input.currentBalance,
      snapshot,
    })

    for (const event of events) {
      await this.repo.appendEvent(event)
    }

    // Score пересчитан на этом спине — кэш надо сбросить (§6.4).
    await this.cache.invalidate(nextState.userId, nextState.gameId)

    return { state: nextState, writtenEvents: events.length }
  }

  /**
   * §11.3 — журнал решений: смена фазы, кредит реактивации и механики
   * (rtp_adjusted / ldw_applied / near_miss_applied) в одном месте.
   */
  private buildEvents(args: {
    input: TrackSpinInput
    state: EngagementState
    phaseChanged: boolean
  }): EngagementEventInput[] {
    const { input, state, phaseChanged } = args
    const events: EngagementEventInput[] = []
    const groupField =
      input.experimentGroup === null ? {} : { experimentGroup: input.experimentGroup }

    if (phaseChanged) {
      events.push({
        userId: state.userId,
        gameId: state.gameId,
        sessionId: input.sessionId,
        eventType: 'phase_changed',
        spinIndex: state.totalSpins,
        phase: state.phase,
        payload: {
          from: input.previousPhase,
          to: state.phase,
          reason: input.phaseReason,
          ...groupField,
        },
      })
    }

    if (input.reactivationTriggered) {
      events.push({
        userId: state.userId,
        gameId: state.gameId,
        sessionId: input.sessionId,
        eventType: 'reactivation_credited',
        spinIndex: state.totalSpins,
        phase: state.phase,
        payload: {
          creditAmount: input.reactivationCredit,
          balanceAfter: input.currentBalance,
          reactivationCount: state.reactivationCount,
          ...groupField,
        },
      })
    }

    for (const pending of input.pendingEvents) {
      events.push({
        userId: state.userId,
        gameId: state.gameId,
        sessionId: input.sessionId,
        eventType: pending.eventType,
        spinIndex: state.totalSpins,
        phase: state.phase,
        payload: { ...pending.payload, ...groupField },
      })
    }

    return events
  }
}
