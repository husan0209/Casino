/**
 * ТЗ ч.9 §6.1, §4.1, §5.2 — UC-ENG-01 CalculateEngagementUseCase.
 *
 * Загружает состояние пары (или создаёт его) и считает всё, что нужно спину:
 * Score, поведенческие сигналы, шаг цикла баланса и следующую фазу.
 * Score кэшируется в Redis (§6.4) — он меняется медленно, а считается на
 * каждом спине.
 *
 * Фаза пересчитывается здесь же, до генерации исхода: механики LDW/Near-Miss
 * обязаны применяться в новой фазе, иначе спин, на котором игрок ушёл в
 * COOLDOWN, получил бы «манипуляцию» в фазе, которая её запрещает (§17).
 */
import { Inject, Injectable } from '@nestjs/common'

import type { Currency, MoneyAmount } from '@casino/shared-types'

import {
  calculateEngagementScoreFromSignals,
  computeBehaviorSignals,
  createEngagementState,
  evaluateBalanceCycle,
  nextPhase,
  resetForNewSession,
  type BalanceCycle,
  type EngagementConfig,
  type EngagementScore,
  type EngagementState,
  type PhaseTransition,
  type PlayerBehaviorSignals,
} from '../../../domain/engagement'
import { ENGAGEMENT_CACHE } from '../../../domain/repositories/engagement-cache.port'
import {
  ENGAGEMENT_REPOSITORY,
  type IEngagementRepository,
} from '../../../domain/repositories/engagement.repository'

export interface CalculateEngagementInput {
  userId: string
  gameId: string
  currency: Currency
  currentBalance: MoneyAmount
  config: EngagementConfig
  now?: number
  sessionEnded?: boolean
  /** §3.1/§10.1 — сессия спина: смена сессии перезапускает цикл баланса. */
  sessionId?: string | null
}

export interface EngagementContext {
  readonly state: EngagementState
  readonly score: EngagementScore
  readonly signals: PlayerBehaviorSignals
  readonly cycle: BalanceCycle
  readonly transition: PhaseTransition
  readonly isNewState: boolean
  /** §10.1 — состояние перезапущено из-за смены сессии (resetState). */
  readonly sessionReset: boolean
  /** Score взят из кэша — для метрик §11.2. */
  readonly scoreFromCache: boolean
}

@Injectable()
export class CalculateEngagementUseCase {
  constructor(
    @Inject(ENGAGEMENT_REPOSITORY) private readonly repo: IEngagementRepository,
    @Inject(ENGAGEMENT_CACHE)
    private readonly cache: {
      getScore(userId: string, gameId: string): Promise<number | null>
      setScore(userId: string, gameId: string, score: number): Promise<void>
    },
  ) {}

  async execute(input: CalculateEngagementInput): Promise<EngagementContext> {
    const now = input.now ?? Date.now()
    const persisted = await this.repo.getState(input.userId, input.gameId, input.currency)

    const isNewState = persisted === null
    const { state, sessionReset } = this.resolveState(persisted, input)

    const signals = computeBehaviorSignals(state, input.currentBalance, now)

    const { score, scoreFromCache } = await this.resolveScore(state, input, signals)

    const cycle = evaluateBalanceCycle(state, input.currentBalance, state.phase)
    const transition = nextPhase({
      state,
      currentBalance: input.currentBalance,
      signals,
      config: input.config,
      now,
      ...(input.sessionEnded === undefined ? {} : { sessionEnded: input.sessionEnded }),
    })

    return { state, score, signals, cycle, transition, isNewState, sessionReset, scoreFromCache }
  }

  /**
   * §10.1 resetState — смена сессии перезапускает цикл: лимит реактиваций §4.2
   * считается «за сессию», база §4.1 — баланс на её старте. Сравнение идёт по
   * `lastSessionId`: до первой записи движка (легаси-строка без сессии) состояние
   * лишь «усыновляет» текущую сессию без сброса.
   */
  private resolveState(
    persisted: EngagementState | null,
    input: CalculateEngagementInput,
  ): { state: EngagementState; sessionReset: boolean } {
    const sessionId = input.sessionId ?? null
    if (persisted === null) {
      // §3.1 initialDeposit — база виртуальной подушки. Для новой пары это
      // баланс на момент первого спина: дальше база не меняется, иначе цикл
      // §4.1 «поехал» бы вслед за пополнениями.
      return {
        state: createEngagementState({
          userId: input.userId,
          gameId: input.gameId,
          currency: input.currency,
          initialDeposit: input.currentBalance,
          currentBalance: input.currentBalance,
          sessionId,
        }),
        sessionReset: false,
      }
    }
    if (sessionId === null || persisted.lastSessionId === null) {
      return { state: persisted, sessionReset: false }
    }
    if (persisted.lastSessionId !== sessionId) {
      return {
        state: resetForNewSession({
          state: persisted,
          currentBalance: input.currentBalance,
          sessionId,
        }),
        sessionReset: true,
      }
    }
    return { state: persisted, sessionReset: false }
  }

  private async resolveScore(
    state: EngagementState,
    input: CalculateEngagementInput,
    signals: PlayerBehaviorSignals,
  ): Promise<{ score: EngagementScore; scoreFromCache: boolean }> {
    const cached = await this.cache.getScore(input.userId, input.gameId)
    if (cached !== null && state.totalSpins > 0) {
      // Из кэша берём только число Score; разложение по компонентам считаем заново,
      // чтобы логи и события не расходились с кэшем.
      const full = calculateEngagementScoreFromSignals(state, signals)
      return { score: { ...full, value: cached }, scoreFromCache: true }
    }
    const score = calculateEngagementScoreFromSignals(state, signals)
    if (state.totalSpins > 0) {
      await this.cache.setScore(input.userId, input.gameId, score.value)
    }
    return { score, scoreFromCache: false }
  }
}
