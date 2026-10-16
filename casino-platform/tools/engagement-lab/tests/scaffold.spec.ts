import { Decimal } from 'decimal.js'
import { describe, expect, it } from 'vitest'

import { money } from '@casino/shared-utils'

import { buildHouseSlotLottery } from '../../../apps/api/src/modules/casino/application/use-cases/house-slot-lottery'
import { RING_BUFFER_SIZE } from '../src/config'
import { type EngagementState } from '../src/domain/types'
import { createBaselineEngine } from '../src/engine/baseline-engine'
import { winTotalOf } from '../src/engine/spin-math'
import { createInitialState, recordSpin } from '../src/engine/state-transitions'
import { findLabGame, winPayoutsOf } from '../src/game-data'
import { createSeededRandom } from '../src/rng'

const SPINS = 20_000

function runBaseline(seed: number): { rtp: number; state: EngagementState; multipliers: number[] } {
  const engine = createBaselineEngine()
  const game = findLabGame('fortunetiger')
  const random = createSeededRandom(seed)
  let state = createInitialState({
    userId: 'player-1',
    gameId: game.externalGameId,
    sessionId: 'session-1',
    initialDeposit: '1000',
    startedAt: new Date(0),
  })
  let totalBet = '0'
  let totalWin = '0'
  const multipliers: number[] = []

  for (let spin = 0; spin < SPINS; spin++) {
    const result = engine.spin({
      state,
      game,
      request: {
        betTotal: '5',
        paylines: game.paylines,
        balanceBefore: '1000000',
        spinAt: new Date(spin * 3000),
      },
      random,
    })
    state = result.state
    totalBet = money.add(totalBet, '5')
    totalWin = money.add(totalWin, result.outcome.winTotal)
    multipliers.push(result.outcome.payoutMultiplier)
  }

  return {
    rtp: new Decimal(money.divide(money.multiply(totalWin, '100'), totalBet)).toNumber(),
    state,
    multipliers,
  }
}

describe('каркас лаборатории', () => {
  it('лотерея калибрует аналитический RTP ровно в заявленный', () => {
    const game = findLabGame('fortunetiger')
    const payouts = winPayoutsOf(game)
    const lottery = buildHouseSlotLottery({
      gameCode: game.externalGameId,
      winPayouts: payouts,
      targetRtp: game.baseRtp,
      paylines: game.paylines,
    })
    const expectedPerSpin = payouts.reduce(
      (sum, payout, index) => sum + payout * (lottery.winProbabilities[index] ?? 0),
      0,
    )
    const analyticRtp = (expectedPerSpin / game.paylines) * 100
    expect(analyticRtp).toBeCloseTo(96, 6)
  })

  it('эмпирический RTP baseline в пределах дисперсии таблицы', () => {
    const { rtp } = runBaseline(20261015)
    // Две строки таблицы платят 250x: на 20k спинов разброс шумит сильно.
    expect(rtp).toBeGreaterThan(85)
    expect(rtp).toBeLessThan(115)
  })

  it('один seed даёт тот же прогон', () => {
    const first = runBaseline(7)
    const second = runBaseline(7)
    expect(first.multipliers.slice(0, 500)).toEqual(second.multipliers.slice(0, 500))
    expect(first.rtp).toBe(second.rtp)
  })

  it('winTotalOf считает по боевой формуле', () => {
    expect(winTotalOf('5', 2, 5)).toBe('2')
    expect(winTotalOf('5', 0, 5)).toBe('0')
  })

  it('ring buffer не растёт дольше лимита', () => {
    let state = createInitialState({
      userId: 'player-1',
      gameId: 'fortunetiger',
      sessionId: 'session-1',
      initialDeposit: '1000',
      startedAt: new Date(0),
    })
    for (let spin = 0; spin < RING_BUFFER_SIZE + 40; spin++) {
      state = recordSpin(state, {
        betTotal: '5',
        winTotal: '0',
        balanceAfter: '995',
        spinAt: new Date(spin * 1000),
        isWin: false,
        isLdw: false,
        isNearMiss: false,
        targetRtp: '96',
      })
    }
    expect(state.spinTimestamps).toHaveLength(RING_BUFFER_SIZE)
    expect(state.betAmounts).toHaveLength(RING_BUFFER_SIZE)
    expect(state.totalSpins).toBe(RING_BUFFER_SIZE + 40)
  })
})
