/**
 * ТЗ ч.9 §9.1 — движок вовлечения как сервис.
 *
 * Разбит на три шага ровно по порядку §9.1, потому что исход спина рождается
 * в `OriginalsSpinUseCase` (там лотерея, кошелёк и раунд), а движок отвечает
 * за решения вокруг него:
 *
 *   prepare()      — состояние, Score, цикл баланса, реактивация, RTP спина;
 *   applyMechanics() — LDW и Near-Miss ПОСЛЕ розыгрыша (§8.1/§8.2: они
 *                      подменяют исход, а не вероятность);
 *   track()        — запись состояния, буферов и журнала §11.3 + метрики §11.1.
 *
 * Движок выключен по умолчанию (§17 и config.enabled): при disabled все три
 * шага — no-op, спин идёт по базовой ветке без изменений. Включение — это
 * либо полный роллаут, либо A/B-эксперимент §12: доля трафика
 * `ENGAGEMENT_EXPERIMENT_TRAFFIC_SHARE` и соль задают детерминированную
 * группу игрока, а группа — какие механики для него работают.
 *
 * §10.1 `resetState` перезапускает цикл при смене сессии; в рантайме это
 * делает CalculateEngagementUseCase (сравнение `lastSessionId`), а публичный
 * метод остаётся для операций и интеграционных тестов.
 */
import { Inject, Injectable, Logger } from '@nestjs/common'

import type { Currency, MoneyAmount } from '@casino/shared-types'
import { money } from '@casino/shared-utils'

import { EngagementMetricsService } from './engagement-metrics.service'
import {
  assignExperiment,
  createEngagementState,
  cumulativeRtpPercent,
  resetForNewSession,
  resolveEngagementConfig,
  type EngagementConfig,
  type EngagementExperimentAssignment,
  type EngagementExperimentFlags,
  type EngagementPhase,
  type EngagementState,
} from '../../domain/engagement'
import { ENGAGEMENT_CACHE } from '../../domain/repositories/engagement-cache.port'
import {
  ENGAGEMENT_REPOSITORY,
  type IEngagementRepository,
} from '../../domain/repositories/engagement.repository'
import { AdjustRtpUseCase } from '../use-cases/engagement/adjust-rtp.use-case'
import {
  CalculateEngagementUseCase,
  type EngagementContext,
} from '../use-cases/engagement/calculate-engagement.use-case'
import {
  CheckReactivationUseCase,
  type ReactivationDecision,
} from '../use-cases/engagement/check-reactivation.use-case'
import {
  GenerateNearMissUseCase,
  type NearMissOutcome,
} from '../use-cases/engagement/generate-near-miss.use-case'
import { SelectLdwUseCase, type LdwOutcome } from '../use-cases/engagement/select-ldw.use-case'
import {
  TrackBehaviorUseCase,
  type PendingEngagementEvent,
} from '../use-cases/engagement/track-behavior.use-case'
import { cryptoRandom } from '../use-cases/house-slot-lottery'

import type { HouseSlotPayoutModel, TigerSpinRow } from '../../domain/house-slot-game'

export interface PrepareSpinInput {
  userId: string
  gameId: string
  sessionId: string
  currency: Currency
  currentBalance: MoneyAmount
  /** Базовый RTP игры, проценты. */
  baseRtpPercent: number
  /** Потолок таблицы выплат; null, если таблица не даёт выигрышей. */
  tableCeilingPercent: number | null
  now?: number
}

export interface PreparedSpin {
  readonly enabled: boolean
  readonly context: EngagementContext | null
  /** RTP для лотереи в процентах; null, когда движок выключен. */
  readonly rtpPercent: number | null
  /** Базовый RTP игры — база для метрики отклонения §11.1. */
  readonly baseRtpPercent: number
  /** Отклонение RTP спина от базового, п.п. (§11.1 `rtp_adjustment_avg`). */
  readonly rtpDeviationPercent: number
  readonly phase: EngagementPhase | null
  readonly reactivation: ReactivationDecision | null
  /** Фаза, к которой применяются механики этого спина. */
  readonly mechanicsPhase: EngagementPhase | null
  /** §12 — группа эксперимента и флаги механик этого спина. */
  readonly assignment: EngagementExperimentAssignment | null
  /** События журнала, подготовленные на шагах prepare (§11.3). */
  readonly pendingEvents: readonly PendingEngagementEvent[]
}

/** Результат шага механик: чем подменили исход (или ничем). */
export interface MechanicsResult {
  readonly row: TigerSpinRow | null
  readonly isLdw: boolean
  readonly isNearMiss: boolean
  /** События `ldw_applied` / `near_miss_applied` для журнала §11.3. */
  readonly pendingEvents: readonly PendingEngagementEvent[]
}

@Injectable()
export class EngagementEngineService {
  private readonly logger = new Logger(EngagementEngineService.name)

  constructor(
    @Inject(CalculateEngagementUseCase) private readonly calculate: CalculateEngagementUseCase,
    @Inject(AdjustRtpUseCase) private readonly adjustRtp: AdjustRtpUseCase,
    @Inject(CheckReactivationUseCase) private readonly checkReactivation: CheckReactivationUseCase,
    @Inject(SelectLdwUseCase) private readonly selectLdw: SelectLdwUseCase,
    @Inject(GenerateNearMissUseCase) private readonly generateNearMiss: GenerateNearMissUseCase,
    @Inject(TrackBehaviorUseCase) private readonly trackBehavior: TrackBehaviorUseCase,
    @Inject(ENGAGEMENT_REPOSITORY) private readonly repo: IEngagementRepository,
    @Inject(ENGAGEMENT_CACHE)
    private readonly cache: { invalidate(userId: string, gameId: string): Promise<void> },
    @Inject(EngagementMetricsService) private readonly metrics: EngagementMetricsService,
  ) {}

  /** §17 — движок работает только на реальных деньгах и по правилам групп §12. */
  isEnabledFor(userId: string, isDemo: boolean): boolean {
    const config = this.config()
    if (!config.enabled) {
      return false
    }
    if (isDemo) {
      return false
    }
    return assignExperiment(userId, config).enrolled
  }

  config(): EngagementConfig {
    return resolveEngagementConfig()
  }

  /** §12 — группа эксперимента игрока (для тестов и операционной диагностики). */
  assignmentFor(userId: string): EngagementExperimentAssignment {
    return assignExperiment(userId, this.config())
  }

  async prepare(input: PrepareSpinInput): Promise<PreparedSpin> {
    const config = this.config()
    const assignment = assignExperiment(input.userId, config)

    // §17/§12.5: выключенный движок и нулевая доля трафика — no-op даже при
    // прямом вызове prepare, а не только через isEnabledFor вызывающего кода.
    if (!config.enabled || !assignment.enrolled) {
      return disabledPreparedSpin(input.baseRtpPercent)
    }

    const context = await this.calculate.execute({
      userId: input.userId,
      gameId: input.gameId,
      currency: input.currency,
      currentBalance: input.currentBalance,
      config,
      sessionId: input.sessionId,
      ...(input.now === undefined ? {} : { now: input.now }),
    })

    // §11.1 — новая пара или новая сессия: знаменатель метрики «на сессию».
    if (context.isNewState || context.sessionReset) {
      this.metrics.recordSessionStart()
    }

    // §4.3 — реактивация проверяется до расчёта RTP: кредит меняет баланс,
    // а RTP спина уже выбирается под новую фазу и новую долю баланса.
    const reactivation = this.checkReactivation.execute({
      state: context.state,
      currentBalance: input.currentBalance,
      config,
      random: cryptoRandom,
    })

    // Фаза спина — та, что получилась из переходов §5.2, а не та, что была
    // на входе: иначе спин, переводящий игрока в COOLDOWN, получил бы LDW.
    const phase = context.transition.phase

    // §7.3 — сглаживание идёт от накопленного RTP сессии: на первом спине
    // опорной точки ещё нет, поэтому стартуем от базового RTP игры.
    const previousRtpPercent = cumulativeRtpPercent(context.state) ?? input.baseRtpPercent
    const adjusted = this.adjustRtp.execute({
      baseRtpPercent: input.baseRtpPercent,
      score: context.score.value,
      phase,
      signals: context.signals,
      state: context.state,
      config,
      tableCeilingPercent: input.tableCeilingPercent,
      previousRtpPercent,
      adaptiveRtpEnabled: assignment.flags.adaptiveRtpEnabled,
    })

    this.logSpinDecision(input, context, phase, adjusted, reactivation, assignment)

    return {
      enabled: true,
      context,
      rtpPercent: adjusted.adjustment.rtpPercent,
      baseRtpPercent: input.baseRtpPercent,
      rtpDeviationPercent: adjusted.adjustment.rtpPercent - input.baseRtpPercent,
      phase,
      reactivation,
      mechanicsPhase: phase,
      assignment,
      pendingEvents: [adjusted.event],
    }
  }

  /**
   * §11.2 — наблюдаемость решений движка. Счётчиков-метрик рантайма в проекте
   * нет (решение ТЗ ч.7 §12.1), поэтому те же значения уходят структурной
   * строкой в лог: по ней считаются распределение фаз, частота LDW/Near-Miss
   * и накопленный RTP. Агрегаты §11.1 — в EngagementMetricsService.
   */
  private logSpinDecision(
    input: PrepareSpinInput,
    context: EngagementContext,
    phase: EngagementPhase,
    adjusted: ReturnType<AdjustRtpUseCase['execute']>,
    reactivation: ReactivationDecision,
    assignment: EngagementExperimentAssignment,
  ): void {
    const payload = {
      engagement_spin: {
        userId: input.userId,
        gameId: input.gameId,
        sessionId: input.sessionId,
        spin: context.state.totalSpins,
        phase,
        phaseChanged: context.transition.changed,
        phaseReason: context.transition.reason,
        score: context.score.value,
        balanceRatio: Number(context.cycle.ratio.toFixed(4)),
        cycleStep: context.cycle.step,
        baseRtpPercent: input.baseRtpPercent,
        rtpPercent: adjusted.adjustment.rtpPercent,
        rtpDrift: context.state.rtpDrift,
        ldwCount: context.state.ldwCount,
        nearMissCount: context.state.nearMissCount,
        reactivationCount: context.state.reactivationCount,
        reactivationTriggered: reactivation.trigger,
        experimentGroup: assignment.group,
        sessionReset: context.sessionReset,
      },
    }
    // Реактивация — самое дорогое решение движка (кредит игроку), её видно
    // всегда; остальное — debug, чтобы не лить лог на каждый спин.
    if (reactivation.trigger) {
      this.logger.warn(payload)
    } else {
      this.logger.debug(payload)
    }
    if (adjusted.adjustment.clampedByTableCeiling) {
      this.logger.debug({
        engagement_rtp_clamped: {
          userId: input.userId,
          gameId: input.gameId,
          sessionId: input.sessionId,
          requested: adjusted.adjustment.rtpPercent,
          ceiling: input.tableCeilingPercent,
          phase,
        },
      })
    }
  }

  /**
   * §8.1/§8.2 — подмена исхода после розыгрыша.
   * Порядок ТЗ: сначала LDW, затем Near-Miss (тот, кто применился последним,
   * и есть исход спина) — так же, как в §9.1. Группы §12 управляют тем, какие
   * механики вообще разрешены на этом спине.
   */
  applyMechanics(args: {
    prepared: PreparedSpin
    winRows: readonly TigerSpinRow[]
    payoutModel: HouseSlotPayoutModel
    config?: EngagementConfig
  }): MechanicsResult {
    const { prepared } = args
    const flags = prepared.assignment?.flags
    if (
      !prepared.enabled ||
      prepared.context === null ||
      prepared.mechanicsPhase === null ||
      !flags
    ) {
      return EMPTY_MECHANICS
    }
    const config = args.config ?? this.config()
    const state = prepared.context.state
    const phase = prepared.mechanicsPhase
    const common = {
      state,
      phase,
      winRows: args.winRows,
      payoutModel: args.payoutModel,
      config,
    }
    const ldw = this.runLdw({ ...common, flags })
    const nearMiss = this.runNearMiss({ ...common, flags })
    this.logAppliedMechanics({ state, phase, score: prepared.context.score.value, ldw, nearMiss })
    return combineMechanics(ldw, nearMiss)
  }

  private runLdw(args: {
    state: EngagementState
    phase: EngagementPhase
    winRows: readonly TigerSpinRow[]
    payoutModel: HouseSlotPayoutModel
    config: EngagementConfig
    flags: EngagementExperimentFlags
  }): LdwOutcome {
    if (!args.flags.ldwEnabled) {
      return LDW_GROUP_DISABLED
    }
    return this.selectLdw.execute({
      state: args.state,
      phase: args.phase,
      winRows: args.winRows,
      payoutModel: args.payoutModel,
      config: args.config,
      random: cryptoRandom,
    })
  }

  private runNearMiss(args: {
    state: EngagementState
    phase: EngagementPhase
    winRows: readonly TigerSpinRow[]
    payoutModel: HouseSlotPayoutModel
    config: EngagementConfig
    flags: EngagementExperimentFlags
  }): NearMissOutcome {
    if (!args.flags.nearMissEnabled) {
      return NEAR_MISS_GROUP_DISABLED
    }
    return this.generateNearMiss.execute({
      state: args.state,
      phase: args.phase,
      winRows: args.winRows,
      payoutModel: args.payoutModel,
      config: args.config,
      random: cryptoRandom,
    })
  }

  /** §11.2 — каждое применение механики видно в логе. */
  private logAppliedMechanics(args: {
    state: EngagementState
    phase: EngagementPhase
    score: number
    ldw: LdwOutcome
    nearMiss: NearMissOutcome
  }): void {
    const { state, phase, score, ldw, nearMiss } = args
    if (ldw.applied) {
      this.logger.debug({
        engagement_outcome_modifier: {
          userId: state.userId,
          gameId: state.gameId,
          type: 'ldw',
          reason: ldw.reason,
          phase,
          score,
          spin: state.totalSpins,
        },
      })
    }
    if (nearMiss.applied) {
      this.logger.debug({
        engagement_outcome_modifier: {
          userId: state.userId,
          gameId: state.gameId,
          type: 'near_miss',
          pattern: nearMiss.pattern,
          phase,
          score,
          spin: state.totalSpins,
        },
      })
    }
  }

  /** §6.2/§3.2/§11.3 — запись состояния, журнала и метрик §11.1. */
  async track(args: {
    prepared: PreparedSpin
    sessionId: string
    bet: MoneyAmount
    win: MoneyAmount
    currentBalance: MoneyAmount
    isLdw: boolean
    isNearMiss: boolean
    reactivationCredit: MoneyAmount
    /** События механик этого спина (из applyMechanics). */
    mechanicsEvents?: readonly PendingEngagementEvent[]
    at?: number
  }): Promise<void> {
    const { prepared } = args
    if (!prepared.enabled || prepared.context === null) {
      return
    }

    const state = prepared.context.state
    const phase = prepared.phase ?? state.phase
    const targetRtpPercent = RTP_TARGET_BY_PHASE[phase]
    // Кредит, который реально ушёл в кошелёк: только он поднимает счётчик
    // реактиваций §4.3 и попадает в журнал — сравнение через деньги, чтобы
    // '0.00000000' не считался кредитом.
    const reactivationTriggered = money.isPositive(args.reactivationCredit)
    const at = args.at ?? Date.now()

    await this.trackBehavior.execute({
      state,
      bet: args.bet,
      win: args.win,
      currentBalance: args.currentBalance,
      sessionId: args.sessionId,
      isLdw: args.isLdw,
      isNearMiss: args.isNearMiss,
      targetRtpPercent,
      phase,
      previousPhase: state.phase,
      score: prepared.context.score.value,
      balanceRatio: prepared.context.cycle.ratio,
      cycleTargetBalance: prepared.context.cycle.targetBalance,
      cycleStep: prepared.context.cycle.step,
      phaseReason: prepared.context.transition.reason,
      reactivationTriggered,
      reactivationCredit: args.reactivationCredit,
      experimentGroup: prepared.assignment?.group ?? null,
      pendingEvents: [...prepared.pendingEvents, ...(args.mechanicsEvents ?? [])],
      at,
    })

    // §11.1 — метрики процесса обновляются после успешной записи состояния:
    // спин учтён ровно тогда, когда он сохранён и виден в журнале.
    this.metrics.recordSpin({
      phase,
      score: prepared.context.score.value,
      rtpDeviationPercent: prepared.rtpDeviationPercent,
      isLdw: args.isLdw,
      isNearMiss: args.isNearMiss,
    })
    if (reactivationTriggered) {
      this.metrics.recordReactivation()
    }
    if (prepared.context.transition.changed) {
      this.metrics.recordPhaseChange({ from: state.phase, to: phase })
    }
  }

  /**
   * §10.1 — сброс состояния под новую сессию. В рантайме смена сессии
   * определяется автоматически (CalculateEngagementUseCase по `lastSessionId`);
   * метод существует для операций (например, ручной перезапуск пилота) и
   * интеграционных проверок полного цикла.
   */
  async resetState(args: {
    userId: string
    gameId: string
    currency: Currency
    initialDeposit: MoneyAmount
    sessionId: string | null
  }): Promise<void> {
    const existing = await this.repo.getState(args.userId, args.gameId, args.currency)
    const next =
      existing === null
        ? createEngagementState({
            userId: args.userId,
            gameId: args.gameId,
            currency: args.currency,
            initialDeposit: args.initialDeposit,
            currentBalance: args.initialDeposit,
            sessionId: args.sessionId,
          })
        : resetForNewSession({
            state: existing,
            currentBalance: args.initialDeposit,
            sessionId: args.sessionId,
          })
    await this.repo.saveState({ state: next, currentBalance: args.initialDeposit, snapshot: null })
    await this.cache.invalidate(args.userId, args.gameId)
    this.metrics.recordSessionStart()
  }
}

/**
 * Плановый RTP фазы для расчёта дрейфа §7.1: середина диапазона §7.2.
 * Дрейф отвечает на вопрос «насколько фактическая отдача разошлась с планом
 * фазы», а не с мгновенным скорректированным значением.
 */
const RTP_TARGET_BY_PHASE: Record<EngagementPhase, number> = {
  onboarding: 107.5,
  retention: 96,
  risk: 100,
  reactivation: 105.5,
  cooldown: 96,
  dormant: 96,
}

/** Заглушки для механик, выключенных группой §12 — без обращения к UC. */
const LDW_GROUP_DISABLED: LdwOutcome = {
  applied: false,
  row: null,
  reason: 'group_disabled',
  targetInterval: 0,
  event: null,
}

const NEAR_MISS_GROUP_DISABLED: NearMissOutcome = {
  applied: false,
  row: null,
  pattern: null,
  reason: 'group_disabled',
  adjustedRate: 0,
  event: null,
}

const EMPTY_MECHANICS: MechanicsResult = {
  row: null,
  isLdw: false,
  isNearMiss: false,
  pendingEvents: [],
}

/** §17/§12.5 — заглушка выключенного движка: prepare вернулся, ничего не решая. */
function disabledPreparedSpin(baseRtpPercent: number): PreparedSpin {
  return {
    enabled: false,
    context: null,
    rtpPercent: null,
    baseRtpPercent,
    rtpDeviationPercent: 0,
    phase: null,
    reactivation: null,
    mechanicsPhase: null,
    assignment: null,
    pendingEvents: [],
  }
}

/**
 * §9.1 шаги 5–6: Near-Miss идёт после LDW и перекрывает его исход.
 * В журнал §11.3 попадает каждое применённое решение: даже перекрытый LDW
 * был решением движка и нужен аналитике частот §11.1.
 */
function combineMechanics(ldw: LdwOutcome, nearMiss: NearMissOutcome): MechanicsResult {
  const row = nearMiss.applied ? nearMiss.row : ldw.applied ? ldw.row : null
  const pendingEvents: PendingEngagementEvent[] = []
  if (ldw.event !== null) {
    pendingEvents.push(ldw.event)
  }
  if (nearMiss.event !== null) {
    pendingEvents.push(nearMiss.event)
  }
  return {
    row,
    isLdw: ldw.applied && row === ldw.row,
    isNearMiss: nearMiss.applied && row === nearMiss.row,
    pendingEvents,
  }
}
