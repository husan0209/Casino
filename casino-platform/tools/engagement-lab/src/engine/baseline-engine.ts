import { money } from '@casino/shared-utils'

import { settleBalance, winTotalOf } from './spin-math'
import {
  buildHouseSlotLottery,
  drawHouseSlotOutcome,
} from '../../../../apps/api/src/modules/casino/application/use-cases/house-slot-lottery'
import {
  type TigerSpinRow,
  houseRowPayout,
} from '../../../../apps/api/src/modules/casino/domain/house-slot-game'
import { ZERO } from '../config'
import {
  type EngagementState,
  type LabGame,
  type MoneyAmount,
  type PayoutMultiplier,
  type SpinEngine,
  type SpinOutcome,
  type SpinPlan,
  type SpinResult,
} from '../domain/types'
import { winPayoutsOf } from '../game-data'
import { recordSpin } from './state-transitions'

/** Аргументы спина — контракт SpinEngine (§9.1 шаг 1). */
type BaselineSpinArgs = Parameters<SpinEngine['spin']>[0]

/**
 * Контрольная группа §12.2: боевая лотерея на заявленном RTP игры.
 * Ни LDW, ни near-miss, ни адаптаций RTP — точка отсчёта для всех замеров.
 */
export function createBaselineEngine(): SpinEngine {
  return {
    name: 'baseline',
    spin: playBaselineSpin,
  }
}

/** Один спин: чистая лотерея игры без механик §8 и без переходов фаз. */
function playBaselineSpin(args: BaselineSpinArgs): SpinResult {
  const { state, game, request, random } = args
  const lottery = buildHouseSlotLottery({
    gameCode: game.externalGameId,
    winPayouts: winPayoutsOf(game),
    targetRtp: game.baseRtp,
    paylines: request.paylines,
  })
  const row = drawHouseSlotOutcome({
    lottery,
    winRows: game.winRows,
    loseRows: game.loseRows,
    random,
  })
  const payoutMultiplier = houseRowPayout(row, game.payoutModel)
  const winTotal = winTotalOf(request.betTotal, payoutMultiplier, request.paylines)
  const isWin = money.isPositive(winTotal)
  const balanceAfter = settleBalance({
    balanceBefore: request.balanceBefore,
    betTotal: request.betTotal,
    winTotal,
  })
  const nextState = recordSpin(state, {
    betTotal: request.betTotal,
    winTotal,
    balanceAfter,
    spinAt: request.spinAt,
    isWin,
    isLdw: false,
    isNearMiss: false,
    targetRtp: game.baseRtp,
  })

  return {
    state: nextState,
    plan: baselinePlanOf(state, game),
    outcome: baselineOutcomeOf({ row, payoutMultiplier, winTotal, isWin }),
    phaseAfter: nextState.engagementPhase,
    scoreAfter: nextState.engagementScore,
    reactivationCredit: null,
    balanceAfter,
  }
}

/** План контрольной группы: заявленный RTP игры, механики §8 не запрашиваются. */
function baselinePlanOf(state: EngagementState, game: LabGame): SpinPlan {
  return {
    behaviorSignals: null,
    scoreBefore: state.engagementScore,
    phaseBefore: state.engagementPhase,
    targetRtp: game.baseRtp,
    rtpDriftCompensation: ZERO,
    reactivationTrigger: false,
    reactivationTargetBalance: null,
    ldwRequested: false,
    nearMissRequested: false,
  }
}

/** Исход контрольной группы: LDW/Near-Miss не срабатывали. */
function baselineOutcomeOf(args: {
  row: TigerSpinRow
  payoutMultiplier: PayoutMultiplier
  winTotal: MoneyAmount
  isWin: boolean
}): SpinOutcome {
  return {
    row: args.row,
    payoutMultiplier: args.payoutMultiplier,
    winTotal: args.winTotal,
    isWin: args.isWin,
    isLdw: false,
    isNearMiss: false,
    nearMissPattern: null,
    ldwReplaced: false,
    nearMissReplaced: false,
  }
}
