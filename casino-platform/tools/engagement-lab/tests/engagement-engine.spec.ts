import { Decimal } from 'decimal.js'
import { describe, expect, it } from 'vitest'

import { money } from '@casino/shared-utils'

import { houseSlotRtpCeiling } from '../../../apps/api/src/modules/casino/application/use-cases/house-slot-lottery'
import { EngagementPhase } from '../src/domain/engagement-phase'
import { type EngagementState, type LabGame, type SpinResult } from '../src/domain/types'
import { createEngagementEngine } from '../src/engine/engagement-engine'
import { createInitialState, markReactivation } from '../src/engine/state-transitions'
import { findLabGame, winPayoutsOf } from '../src/game-data'
import { createSeededRandom } from '../src/rng'

const DEPOSIT = '1000'
const BET = '5'
const SPIN_STEP_MS = 3000

interface RunTrace {
  state: EngagementState
  spins: SpinResult[]
  balances: string[]
}

function runSpins(
  game: LabGame,
  startState: EngagementState,
  spinCount: number,
  seed: number,
  balanceOverride?: string,
): RunTrace {
  const engine = createEngagementEngine()
  const random = createSeededRandom(seed)
  let state = startState
  let balance = balanceOverride ?? startState.currentBalance
  const spins: SpinResult[] = []
  const balances: string[] = []

  for (let index = 0; index < spinCount; index++) {
    const result = engine.spin({
      state,
      game,
      request: {
        betTotal: BET,
        paylines: game.paylines,
        balanceBefore: balance,
        spinAt: new Date((index + 1) * SPIN_STEP_MS),
      },
      random,
    })
    state = result.state
    balance = result.balanceAfter
    spins.push(result)
    balances.push(balance)
  }

  return { state, spins, balances }
}

function freshState(game: LabGame): EngagementState {
  return createInitialState({
    userId: 'player-1',
    gameId: game.externalGameId,
    sessionId: 'session-1',
    initialDeposit: DEPOSIT,
    startedAt: new Date(0),
  })
}

describe('интеграция полного цикла спина (§9.1, §16.1 №21)', () => {
  const game = findLabGame('fortunetiger')

  it('сессия стартует в ONBOARDING и уходит в RETENTION по правилам фаз', () => {
    const { state, spins } = runSpins(game, freshState(game), 40, 4242)
    expect(spins[0]?.plan.phaseBefore).toBe(EngagementPhase.ONBOARDING)
    expect(spins.some((spin) => spin.phaseAfter === EngagementPhase.RETENTION)).toBe(true)
    expect(state.totalSpins).toBe(40)
  })

  it('медовый месяц поднимает баланс выше депозита', () => {
    // Один seed — монетка: замер seeds 0..2999 даёт P(peak > депозит) ≈ 0.54,
    // поэтому проверяем устойчивость по выборке, а не по одному seed.
    const seeds = Array.from({ length: 20 }, (_, index) => index + 1)
    const raised = seeds.filter((seed) => {
      const { balances } = runSpins(game, freshState(game), 15, seed)
      return Math.max(...balances.map((balance) => Number(balance))) > Number(DEPOSIT)
    })
    expect(raised.length / seeds.length).toBeGreaterThanOrEqual(0.3)
  })

  it('точка реактивации возвращает баланс в коридор 70–80 % депозита', () => {
    const lowState: EngagementState = { ...freshState(game), currentBalance: '150' }
    const { spins } = runSpins(game, lowState, 5, 909, '150')
    const triggered = spins.find((spin) => spin.plan.reactivationTrigger)
    expect(triggered).toBeDefined()
    if (!triggered?.plan.reactivationTargetBalance) {
      return
    }
    const ratio = new Decimal(triggered.plan.reactivationTargetBalance).div(DEPOSIT).toNumber()
    expect(ratio).toBeGreaterThanOrEqual(0.7)
    expect(ratio).toBeLessThanOrEqual(0.8)
    expect(money.isPositive(String(triggered.reactivationCredit ?? '0'))).toBe(true)
  })

  it('после лимита реактиваций фаза уходит в COOLDOWN и механики молчат', () => {
    const spentState: EngagementState = {
      ...markReactivation(freshState(game), {
        at: new Date(0),
        balanceAfter: '120',
        targetRtp: '96',
      }),
      reactivationCount: 4,
      currentBalance: '120',
    }
    const { spins } = runSpins(game, spentState, 10, 55, '120')
    const cooldownSpin = spins.find((spin) => spin.phaseAfter === EngagementPhase.COOLDOWN)
    expect(cooldownSpin).toBeDefined()
    const afterCooldown = spins.slice(spins.indexOf(cooldownSpin ?? spins[0]))
    for (const spin of afterCooldown) {
      if (spin.state.engagementPhase !== EngagementPhase.COOLDOWN) {
        continue
      }
      expect(spin.outcome.isLdw).toBe(false)
      expect(spin.outcome.isNearMiss).toBe(false)
    }
  })

  it('адаптированный RTP не выходит за 90–110 % и за потолок таблиц игры', () => {
    const ceiling = houseSlotRtpCeiling(winPayoutsOf(game), game.paylines)
    const { spins } = runSpins(game, freshState(game), 60, 31337)
    for (const spin of spins) {
      const target = Number(spin.plan.targetRtp)
      expect(target).toBeGreaterThanOrEqual(90)
      expect(target).toBeLessThanOrEqual(110)
      expect(target).toBeLessThanOrEqual(ceiling + 0.000001)
    }
  })

  it('узкие таблицы Fortune Ox отсекаются явно, а не тихо', () => {
    const narrowGame = findLabGame('fortuneox')
    const { spins } = runSpins(narrowGame, freshState(narrowGame), 20, 8181)
    const onboardingSpin = spins.find(
      (spin) => spin.plan.phaseBefore === EngagementPhase.ONBOARDING,
    )
    const ceiling = houseSlotRtpCeiling(winPayoutsOf(narrowGame), narrowGame.paylines)
    expect(onboardingSpin).toBeDefined()
    expect(Number(onboardingSpin?.plan.targetRtp)).toBeLessThanOrEqual(ceiling + 0.000001)
  })

  it('один и тот же seed даёт идентичный прогон', () => {
    const first = runSpins(game, freshState(game), 30, 1234)
    const second = runSpins(game, freshState(game), 30, 1234)
    expect(first.balances).toEqual(second.balances)
    expect(first.state.cumulativeRtp).toBe(second.state.cumulativeRtp)
  })
})
