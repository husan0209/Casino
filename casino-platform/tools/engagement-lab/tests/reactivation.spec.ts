import { Decimal } from 'decimal.js'
import { describe, expect, it } from 'vitest'

import { money } from '@casino/shared-utils'

import { BALANCE_CYCLE } from '../src/config'
import { type EngagementState, type MoneyAmount, type RandomFn } from '../src/domain/types'
import { checkReactivationTrigger } from '../src/engine/reactivation'
import { createInitialState } from '../src/engine/state-transitions'
import { createSeededRandom } from '../src/rng'

/** constant random: фиксированные значения для точных проверок targetBalance. */
function constantRandom(value: number): RandomFn {
  return () => value
}

function stateAt(args: {
  initialDeposit?: MoneyAmount
  reactivationCount?: number
  totalSpins?: number
  lastReactivationSpin?: number
  spinsSinceReactivation?: number
}): EngagementState {
  const base = createInitialState({
    userId: 'player-1',
    gameId: 'fortunetiger',
    sessionId: 'session-1',
    initialDeposit: args.initialDeposit ?? '1000',
    startedAt: new Date(0),
  })
  return {
    ...base,
    initialDeposit: args.initialDeposit ?? '1000',
    totalSpins: args.totalSpins ?? 30,
    reactivationCount: args.reactivationCount ?? 0,
    counters: {
      ...base.counters,
      lastReactivationSpin: args.lastReactivationSpin ?? 0,
      spinsSinceReactivation: args.spinsSinceReactivation ?? Number.MAX_SAFE_INTEGER,
    },
  }
}

const DEPOSIT_1000 = stateAt({})

describe('§4.3 checkReactivationTrigger', () => {
  it('условие 1: граница 20 % депозита 1000', () => {
    const random = constantRandom(0.5)

    expect(checkReactivationTrigger(DEPOSIT_1000, '199.99', random).trigger).toBe(true)
    expect(checkReactivationTrigger(DEPOSIT_1000, '200.00', random)).toEqual({
      trigger: false,
      targetBalance: null,
      credit: null,
    })
    expect(checkReactivationTrigger(DEPOSIT_1000, '200.01', random).trigger).toBe(false)
  })

  it('условие 2: лимит реактиваций = 4 (§17: 3 можно, 4-я нет)', () => {
    expect(BALANCE_CYCLE.maxReactivations).toBe(4)

    const third = stateAt({ reactivationCount: 3 })
    expect(checkReactivationTrigger(third, '150', constantRandom(0.5)).trigger).toBe(true)

    const fourth = stateAt({ reactivationCount: 4 })
    expect(checkReactivationTrigger(fourth, '150', constantRandom(0.5))).toEqual({
      trigger: false,
      targetBalance: null,
      credit: null,
    })
  })

  it('условие 3: первая реактивация не ждёт паузы; после неё 9 спинов — нет, 10 — да', () => {
    expect(BALANCE_CYCLE.minSpinsBetweenReactivations).toBe(10)

    const firstSession = stateAt({ totalSpins: 0 }) // sentinel = первая реактивация
    expect(checkReactivationTrigger(firstSession, '150', constantRandom(0.5)).trigger).toBe(true)

    const nine = stateAt({ totalSpins: 40, spinsSinceReactivation: 9 })
    expect(checkReactivationTrigger(nine, '150', constantRandom(0.5)).trigger).toBe(false)

    const ten = stateAt({ totalSpins: 40, spinsSinceReactivation: 10 })
    expect(checkReactivationTrigger(ten, '150', constantRandom(0.5)).trigger).toBe(true)
  })

  it('цель — 70–80 % депозита, никогда не 100 % (§17)', () => {
    const randomValues = [0, 0.5, 0.999]
    const seeded = createSeededRandom(20261015)

    for (let run = 0; run < 1000; run++) {
      const value = run % 2 === 0 ? (randomValues[run % 3] as number) : seeded()
      const decision = checkReactivationTrigger(DEPOSIT_1000, '150', constantRandom(value))
      expect(decision.trigger).toBe(true)
      const target = new Decimal(decision.targetBalance as MoneyAmount)
      expect(target.gte(700)).toBe(true)
      expect(target.lte(800)).toBe(true)
      expect(target.equals(1000)).toBe(false)
      expect(target.gt(new Decimal(DEPOSIT_1000.initialDeposit))).toBe(false)
    }

    expect(checkReactivationTrigger(DEPOSIT_1000, '150', constantRandom(0)).targetBalance).toBe(
      '700',
    )
    expect(checkReactivationTrigger(DEPOSIT_1000, '150', constantRandom(0.5)).targetBalance).toBe(
      '750',
    )
    expect(checkReactivationTrigger(DEPOSIT_1000, '150', constantRandom(0.999)).targetBalance).toBe(
      '799.9',
    )
  })

  it('credit = targetBalance - currentBalance, посчитан ровно', () => {
    const balance = '150'
    const decision = checkReactivationTrigger(DEPOSIT_1000, balance, constantRandom(0.5))
    expect(decision.targetBalance).toBe('750')
    expect(decision.credit).toBe('600')
    expect(money.add(balance, decision.credit as MoneyAmount)).toBe(decision.targetBalance)

    const oddBalance = checkReactivationTrigger(DEPOSIT_1000, '199.99', constantRandom(0.999))
    expect(oddBalance.targetBalance).toBe('799.9')
    expect(oddBalance.credit).toBe('599.91')
  })

  it('credit никогда не отрицательный: цель всегда выше баланса', () => {
    const balances: MoneyAmount[] = ['0', '0.00000001', '1', '99.9', '150', '199.99']
    for (const balance of balances) {
      for (const value of [0, 0.25, 0.5, 0.999]) {
        const decision = checkReactivationTrigger(DEPOSIT_1000, balance, constantRandom(value))
        expect(decision.trigger).toBe(true)
        const credit = new Decimal(decision.credit as MoneyAmount)
        expect(credit.gt(0)).toBe(true)
      }
    }
  })

  it('initialDeposit = 0: без деления на ноль, триггера нет', () => {
    const zeroDeposit = stateAt({ initialDeposit: '0' })
    for (const balance of ['0', '150', '199.99']) {
      const decision = checkReactivationTrigger(zeroDeposit, balance, constantRandom(0.5))
      expect(decision).toEqual({ trigger: false, targetBalance: null, credit: null })
    }

    const negativeDeposit = stateAt({ initialDeposit: '-1000' })
    expect(checkReactivationTrigger(negativeDeposit, '-1500', constantRandom(0.5)).trigger).toBe(
      false,
    )
  })

  it('случайное значение берётся только из переданного random', () => {
    const calls: number[] = []
    const recordingRandom: RandomFn = () => {
      calls.push(1)
      return 0.5
    }
    const decision = checkReactivationTrigger(DEPOSIT_1000, '150', recordingRandom)
    expect(decision.trigger).toBe(true)
    expect(calls).toHaveLength(1)

    const blockedCalls: number[] = []
    checkReactivationTrigger(DEPOSIT_1000, '200.00', () => {
      blockedCalls.push(1)
      return 0.5
    })
    expect(blockedCalls).toHaveLength(0)
  })

  it('состояние не мутируется: это делает оркестратор через markReactivation', () => {
    const state = stateAt({ reactivationCount: 1, totalSpins: 25, lastReactivationSpin: 12 })
    const snapshot = structuredClone(state)
    checkReactivationTrigger(state, '150', constantRandom(0.5))
    expect(state).toStrictEqual(snapshot)
  })
})
