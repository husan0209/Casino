import { money } from '@casino/shared-utils'

import { type RtpAdjustment, adjustRtp } from './adaptive-rtp'
import { createBaselineEngine } from './baseline-engine'
import { calculateEngagementScore } from './engagement-score'
import { selectLdwRow, shouldApplyLdw } from './ldw'
import { selectNearMissRow, shouldApplyNearMiss } from './near-miss'
import { nextPhaseByGuards } from './phase-fsm'
import { checkReactivationTrigger } from './reactivation'
import { settleBalance, winTotalOf } from './spin-math'
import { recordSpin, markReactivation, updatePhase } from './state-transitions'
import {
  buildHouseSlotLottery,
  drawHouseSlotOutcome,
  houseSlotRtpCeiling,
} from '../../../../apps/api/src/modules/casino/application/use-cases/house-slot-lottery'
import {
  type TigerSpinRow,
  houseRowPayout,
} from '../../../../apps/api/src/modules/casino/domain/house-slot-game'
import { computeBehaviorSignals } from '../domain/behavior-signals'
import { EngagementPhase } from '../domain/engagement-phase'
import {
  type EngagementState,
  type LabGame,
  type MoneyAmount,
  type NearMissSelection,
  type PayoutMultiplier,
  type PlayerBehaviorSignals,
  type RandomFn,
  type ReactivationDecision,
  type SpinEngine,
  type SpinRequest,
  type SpinResult,
} from '../domain/types'
import { winPayoutsOf } from '../game-data'

/** §12.2: какие механики включены у группы. Shape, а не импорт из ab/, чтобы
 * оркестратор не зависел от имени, которое выберет блок A/B. */
export interface EngineMechanics {
  ldw: boolean
  nearMiss: boolean
  adaptiveRtp: boolean
}

const ALL_MECHANICS: EngineMechanics = { ldw: true, nearMiss: true, adaptiveRtp: true }

export interface EngagementEngineOptions {
  /** §12.6: глобальный on/off. Выключенный движок = baseline (§15.2 Level 1). */
  enabled?: boolean
  mechanics?: EngineMechanics
}

/** Аргументы спина — контракт SpinEngine (§9.1 шаг 1). */
type EngagementSpinArgs = Parameters<SpinEngine['spin']>[0]

/**
 * Полный цикл спина по §9.1 и §2.2: состояние -> реактивация -> адаптированный
 * RTP -> розыгрыш -> LDW -> near-miss -> запись результата -> переход фазы.
 *
 * Всё считается на виртуальном балансе симуляции. Ни кошелька, ни БД, ни фронта:
 * лаборатория измеряет алгоритм, а не отдаёт кому-то деньги.
 */
export function createEngagementEngine(options: EngagementEngineOptions = {}): SpinEngine {
  if (options.enabled === false) {
    return createBaselineEngine()
  }
  const mechanics = options.mechanics ?? ALL_MECHANICS
  return {
    name: 'engagement',
    spin: (args) => runEngagementSpin(args, mechanics),
  }
}

/** Контекст решения §9.1 шаги 2–4: сигналы, фаза решения, RTP, реактивация. */
interface DecisionContext {
  signals: PlayerBehaviorSignals
  scoreForDecision: number
  decisionPhase: EngagementPhase
  decisionState: EngagementState
  rtpAdjustment: RtpAdjustment
  reactivation: ReactivationDecision
  reactivationCredit: MoneyAmount | null
}

/** Розыгрыш §9.1 шаги 5–7: лотерея, LDW (§8.1), near-miss (§8.2). */
interface MechanicsOutcome {
  row: TigerSpinRow
  ldwApplied: boolean
  nearMissSelection: NearMissSelection | null
  payoutMultiplier: PayoutMultiplier
  spinWin: MoneyAmount
  isWin: boolean
}

/** Пост-состояние спина после записи, скоринга и перехода фазы. */
interface CommittedSpin {
  state: EngagementState
  phaseAfter: EngagementPhase
  scoreAfter: number
  balanceAfter: MoneyAmount
}

/** Один спин: решение -> розыгрыш механик -> запись -> итог. */
function runEngagementSpin(args: EngagementSpinArgs, mechanics: EngineMechanics): SpinResult {
  const { state, game, request, random } = args
  const decision = resolveDecisionContext({ state, game, request, random, mechanics })
  const outcome = drawMechanicsOutcome({
    game,
    request,
    random,
    mechanics,
    decisionState: decision.decisionState,
    targetRtp: decision.rtpAdjustment.targetRtp,
  })
  const committed = commitEngagementSpin({ state, request, decision, outcome })
  return buildEngagementResult({ state, decision, outcome, committed, mechanics })
}

function resolveDecisionContext(args: {
  state: EngagementState
  game: LabGame
  request: SpinRequest
  random: RandomFn
  mechanics: EngineMechanics
}): DecisionContext {
  const { state, game, request, random, mechanics } = args
  const signals = computeBehaviorSignals(state, request.spinAt.getTime())
  const scoreForDecision = calculateEngagementScore(state, signals)

  // §5.2/§17: фаза решений этого спина — переход FSM от входного состояния,
  // посчитанный ДО механик: спин, переводящий игрока в COOLDOWN, уже «чистый».
  const decisionPhase = nextPhaseByGuards(state, signals, request.spinAt)
  const decisionState: EngagementState = { ...state, engagementPhase: decisionPhase }

  const rtpAdjustment: RtpAdjustment = mechanics.adaptiveRtp
    ? adjustRtp({
        baseRtp: Number(game.baseRtp),
        score: scoreForDecision,
        phase: decisionPhase,
        signals,
        state,
        tableCeiling: houseSlotRtpCeiling(winPayoutsOf(game), request.paylines),
      })
    : { targetRtp: game.baseRtp, driftCompensation: 0, clampedBy: 'none' }

  const reactivation = checkReactivationTrigger(state, request.balanceBefore, random)
  return {
    signals,
    scoreForDecision,
    decisionPhase,
    decisionState,
    rtpAdjustment,
    reactivation,
    reactivationCredit: reactivation.trigger ? reactivation.credit : null,
  }
}

function drawMechanicsOutcome(args: {
  game: LabGame
  request: SpinRequest
  random: RandomFn
  mechanics: EngineMechanics
  decisionState: EngagementState
  targetRtp: MoneyAmount
}): MechanicsOutcome {
  const { game, request, random, mechanics, decisionState, targetRtp } = args
  const lottery = buildHouseSlotLottery({
    gameCode: game.externalGameId,
    winPayouts: winPayoutsOf(game),
    targetRtp,
    paylines: request.paylines,
  })
  let row = drawHouseSlotOutcome({
    lottery,
    winRows: game.winRows,
    loseRows: game.loseRows,
    random,
  })

  let ldwApplied = false
  if (mechanics.ldw && shouldApplyLdw(decisionState, random)) {
    const ldwRow = selectLdwRow(game, request.betTotal, random)
    if (ldwRow) {
      row = ldwRow
      ldwApplied = true
    }
  }

  let nearMissSelection: NearMissSelection | null = null
  if (!ldwApplied && mechanics.nearMiss && shouldApplyNearMiss(decisionState, random)) {
    nearMissSelection = selectNearMissRow(game, decisionState, random)
    if (nearMissSelection) {
      row = nearMissSelection.row
    }
  }

  const payoutMultiplier = houseRowPayout(row, game.payoutModel)
  const spinWin = winTotalOf(request.betTotal, payoutMultiplier, request.paylines)
  return {
    row,
    ldwApplied,
    nearMissSelection,
    payoutMultiplier,
    spinWin,
    isWin: money.isPositive(spinWin),
  }
}

function commitEngagementSpin(args: {
  state: EngagementState
  request: SpinRequest
  decision: DecisionContext
  outcome: MechanicsOutcome
}): CommittedSpin {
  const { state, request, decision, outcome } = args
  /** Бонус реактивации — это деньги, которые игрок получил, поэтому в
   * накопленную отдачу он попадает, а в SpinOutcome — нет. */
  const recordedWin = decision.reactivationCredit
    ? money.add(outcome.spinWin, decision.reactivationCredit)
    : outcome.spinWin
  const balanceAfter = settleBalance({
    balanceBefore: request.balanceBefore,
    betTotal: request.betTotal,
    winTotal: recordedWin,
  })

  const recorded = recordSpin(state, {
    betTotal: request.betTotal,
    winTotal: recordedWin,
    balanceAfter,
    spinAt: request.spinAt,
    isWin: outcome.isWin,
    isLdw: outcome.ldwApplied,
    isNearMiss: outcome.nearMissSelection !== null,
    targetRtp: decision.rtpAdjustment.targetRtp,
  })

  const scored: EngagementState = {
    ...recorded,
    engagementScore: calculateEngagementScore(
      recorded,
      computeBehaviorSignals(recorded, request.spinAt.getTime()),
    ),
  }

  const credited = decision.reactivationCredit
    ? markReactivation(scored, {
        at: request.spinAt,
        balanceAfter,
        targetRtp: decision.rtpAdjustment.targetRtp,
      })
    : scored

  // Прод хранит именно решающую фазу спина (`track()` пишет
  // `transition.phase`, посчитанный до розыгрыша). Пересчёт перехода после
  // `recordSpin` давал неактивность ровно 0 и делал DORMANT недостижимым.
  const phaseAfter = decision.reactivation.trigger
    ? EngagementPhase.REACTIVATION
    : decision.decisionPhase

  return {
    state: updatePhase(credited, phaseAfter, request.spinAt),
    phaseAfter,
    scoreAfter: credited.engagementScore,
    balanceAfter,
  }
}

function buildEngagementResult(args: {
  state: EngagementState
  decision: DecisionContext
  outcome: MechanicsOutcome
  committed: CommittedSpin
  mechanics: EngineMechanics
}): SpinResult {
  const { state, decision, outcome, committed, mechanics } = args
  return {
    state: committed.state,
    plan: {
      behaviorSignals: decision.signals,
      scoreBefore: decision.scoreForDecision,
      phaseBefore: state.engagementPhase,
      targetRtp: decision.rtpAdjustment.targetRtp,
      rtpDriftCompensation: String(decision.rtpAdjustment.driftCompensation),
      reactivationTrigger: decision.reactivation.trigger,
      reactivationTargetBalance: decision.reactivation.targetBalance,
      ldwRequested: mechanics.ldw,
      nearMissRequested: mechanics.nearMiss,
    },
    outcome: {
      row: outcome.row,
      payoutMultiplier: outcome.payoutMultiplier,
      winTotal: outcome.spinWin,
      isWin: outcome.isWin,
      isLdw: outcome.ldwApplied,
      isNearMiss: outcome.nearMissSelection !== null,
      nearMissPattern: outcome.nearMissSelection ? outcome.nearMissSelection.pattern : null,
      ldwReplaced: outcome.ldwApplied,
      nearMissReplaced: outcome.nearMissSelection !== null,
    },
    phaseAfter: committed.phaseAfter,
    scoreAfter: committed.scoreAfter,
    reactivationCredit: decision.reactivationCredit,
    balanceAfter: committed.balanceAfter,
  }
}
