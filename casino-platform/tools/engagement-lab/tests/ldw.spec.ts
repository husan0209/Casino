import { describe, expect, it } from 'vitest'

import {
  houseRowPayout,
  type TigerSpinRow,
} from '../../../apps/api/src/modules/casino/domain/house-slot-game'
import { LDW_CONFIG, SIMULATION_SUCCESS_CRITERIA } from '../src/config'
import { EngagementPhase } from '../src/domain/engagement-phase'
import { type EngagementState, type LabGame, type RandomFn } from '../src/domain/types'
import { selectLdwRow, shouldApplyLdw, spinsSinceLastLdw } from '../src/engine/ldw'
import { winRatioOf } from '../src/engine/spin-math'
import { createInitialState, recordSpin, updatePhase } from '../src/engine/state-transitions'
import { findLabGame, winPayoutsOf } from '../src/game-data'
import { createSeededRandom } from '../src/rng'

const SERIES_SPINS = 2000
const BET_TOTAL = '5'

/** Равномерный random без dithering: dither = (0.5-0.5)*2*0.05 = 0. */
const steadyRandom: RandomFn = () => 0.5

/**
 * Детерминированный чередующийся random: чётные спины дают dither
 * «минимум» (-0.05), нечётные — почти «максимум» (+0.04). Последняя
 * величина выбрана < 1, потому что RandomFn по контракту — [0,1).
 */
function alternatingRandom(): RandomFn {
  let callIndex = 0
  return () => {
    const value = callIndex % 2 === 0 ? 0 : 0.9
    callIndex += 1
    return value
  }
}

function trackedRandom(base: RandomFn): { random: RandomFn; calls: () => number } {
  let calls = 0
  return {
    calls: () => calls,
    random: () => {
      calls += 1
      return base()
    },
  }
}

function freshState(phase: EngagementPhase = EngagementPhase.ONBOARDING): EngagementState {
  return updatePhase(
    createInitialState({
      userId: 'player-ldw',
      gameId: 'fortunetiger',
      sessionId: 'session-ldw',
      initialDeposit: '1000',
      startedAt: new Date(0),
    }),
    phase,
    new Date(0),
  )
}

/** Состояние, у которого с последнего LDW прошло ровно spinsSince спинов. */
function stateWithSpinsSince(spinsSince: number, phase: EngagementPhase): EngagementState {
  const base = freshState(phase)
  const totalSpins = 100
  return {
    ...base,
    totalSpins,
    counters: { ...base.counters, lastLdwSpin: totalSpins - spinsSince },
  }
}

/** Интервал §8.1: round(1/частота) без dithering. */
function intervalOf(frequency: number): number {
  return Math.round(1 / frequency)
}

/**
 * Прогон §8.1 на реальном состоянии: решение shouldApplyLdw -> recordSpin
 * (§3.1 двигает counters.lastLdwSpin), следующий спин уже считает
 * spinsSinceLastLdw по-настоящему.
 */
function runLdwSeries(
  phase: EngagementPhase,
  spins: number,
  random: RandomFn,
): { decisions: boolean[]; fires: number; frequency: number; gaps: number[] } {
  const decisions: boolean[] = []
  const gaps: number[] = []
  let state = freshState(phase)
  let spinsSinceLastFire = 0
  let fires = 0

  for (let spinIndex = 0; spinIndex < spins; spinIndex += 1) {
    const fire = shouldApplyLdw(state, random)
    decisions.push(fire)
    if (fire) {
      fires += 1
      gaps.push(spinsSinceLastFire + 1)
      spinsSinceLastFire = 0
    } else {
      spinsSinceLastFire += 1
    }

    state = recordSpin(state, {
      betTotal: BET_TOTAL,
      winTotal: fire ? '3' : '0',
      balanceAfter: '1000',
      spinAt: new Date(spinIndex * 1000),
      isWin: fire,
      isLdw: fire,
      isNearMiss: false,
      targetRtp: '96',
    })
  }

  return { decisions, fires, frequency: fires / spins, gaps }
}

/** Кандидаты окна §8.1 как доля ставки — независимый повтор формулы для замера. */
function candidateRatiosOf(game: LabGame): number[] {
  return winPayoutsOf(game)
    .map((payout) => winRatioOf(payout, game.paylines))
    .filter((ratio) => ratio >= LDW_CONFIG.minPayoutRatio && ratio <= LDW_CONFIG.maxPayoutRatio)
}

function payoutsOfSelected(game: LabGame, randoms: number[]): number[] {
  return randoms.map((value) => {
    const row = selectLdwRow(game, BET_TOTAL, () => value)
    return row === null ? -1 : houseRowPayout(row, game.payoutModel)
  })
}

/** Синтетическая строка донора: для payoutModel 'single' выплата лежит в [5]. */
function singleRow(payout: number): TigerSpinRow {
  return [[], [], [], [], 1, payout]
}

/**
 * Синтетическая таблица для проверки границ окна. 100 линий выбраны специально:
 * при них ratio 0.29/0.30/0.60/0.61 представляются в double точно, и сравнение
 * границ проверяется без защитного epsilon.
 */
function syntheticGame(paylines: number, payouts: number[]): LabGame {
  return {
    externalGameId: 'synthetic-ldw-window',
    displayName: 'Синтетическая таблица для границ окна LDW',
    payoutModel: 'single',
    baseRtp: '96',
    winRows: payouts.map((payout) => singleRow(payout)),
    loseRows: [],
    paytable: { success: true, data: [], message: 'fixture' },
    paylines,
  }
}

describe('§8.1 spinsSinceLastLdw', () => {
  it('на старте сессии равен 0 и считается от последнего LDW', () => {
    const start = freshState()
    expect(spinsSinceLastLdw(start)).toBe(0)

    const afterLoss = recordSpin(start, {
      betTotal: BET_TOTAL,
      winTotal: '0',
      balanceAfter: '995',
      spinAt: new Date(0),
      isWin: false,
      isLdw: false,
      isNearMiss: false,
      targetRtp: '96',
    })
    expect(spinsSinceLastLdw(afterLoss)).toBe(1)

    const afterLdw = recordSpin(afterLoss, {
      betTotal: BET_TOTAL,
      winTotal: '3',
      balanceAfter: '998',
      spinAt: new Date(1000),
      isWin: true,
      isLdw: true,
      isNearMiss: false,
      targetRtp: '96',
    })
    expect(spinsSinceLastLdw(afterLdw)).toBe(0)
    expect(
      spinsSinceLastLdw(
        recordSpin(afterLdw, {
          betTotal: BET_TOTAL,
          winTotal: '0',
          balanceAfter: '993',
          spinAt: new Date(2000),
          isWin: false,
          isLdw: false,
          isNearMiss: false,
          targetRtp: '96',
        }),
      ),
    ).toBe(1)
  })
})

describe('§8.1 shouldApplyLdw: частоты по всем шести фазам (§5.3)', () => {
  it('ONBOARDING 0.15 -> интервал 7, окно открывается на 6-м спине', () => {
    expect(LDW_CONFIG.targetFrequency[EngagementPhase.ONBOARDING]).toBe(0.15)
    expect(intervalOf(0.15)).toBe(7)
    expect(shouldApplyLdw(stateWithSpinsSince(5, EngagementPhase.ONBOARDING), steadyRandom)).toBe(
      false,
    )
    expect(shouldApplyLdw(stateWithSpinsSince(6, EngagementPhase.ONBOARDING), steadyRandom)).toBe(
      true,
    )
  })

  it('RETENTION 0.25 -> интервал 4, то есть каждые 3-4 спина', () => {
    expect(LDW_CONFIG.targetFrequency[EngagementPhase.RETENTION]).toBe(0.25)
    expect(intervalOf(0.25)).toBe(4)
    expect(shouldApplyLdw(stateWithSpinsSince(2, EngagementPhase.RETENTION), steadyRandom)).toBe(
      false,
    )
    expect(shouldApplyLdw(stateWithSpinsSince(3, EngagementPhase.RETENTION), steadyRandom)).toBe(
      true,
    )
  })

  it('RISK 0.3 -> интервал 3, каждые 2-3 спина', () => {
    expect(LDW_CONFIG.targetFrequency[EngagementPhase.RISK]).toBe(0.3)
    expect(intervalOf(0.3)).toBe(3)
    expect(shouldApplyLdw(stateWithSpinsSince(1, EngagementPhase.RISK), steadyRandom)).toBe(false)
    expect(shouldApplyLdw(stateWithSpinsSince(2, EngagementPhase.RISK), steadyRandom)).toBe(true)
  })

  it('REACTIVATION 0.2 -> интервал 5', () => {
    expect(LDW_CONFIG.targetFrequency[EngagementPhase.REACTIVATION]).toBe(0.2)
    expect(intervalOf(0.2)).toBe(5)
    expect(shouldApplyLdw(stateWithSpinsSince(3, EngagementPhase.REACTIVATION), steadyRandom)).toBe(
      false,
    )
    expect(shouldApplyLdw(stateWithSpinsSince(4, EngagementPhase.REACTIVATION), steadyRandom)).toBe(
      true,
    )
  })

  it('COOLDOWN и DORMANT: никогда, и random не тратится (§17)', () => {
    for (const phase of [EngagementPhase.COOLDOWN, EngagementPhase.DORMANT]) {
      expect(LDW_CONFIG.targetFrequency[phase]).toBe(0)
      for (const value of [0, 0.5, 0.999_999]) {
        const tracker = trackedRandom(() => value)
        expect(shouldApplyLdw(stateWithSpinsSince(10_000, phase), tracker.random)).toBe(false)
        expect(tracker.calls()).toBe(0)
      }
    }
  })

  it('dithering ±0.05 двигает интервал, но не выводит частоту за ±5 %', () => {
    // минимальный dither: 0.25-0.05 = 0.20 -> интервал 5
    expect(shouldApplyLdw(stateWithSpinsSince(3, EngagementPhase.RETENTION), () => 0)).toBe(false)
    expect(shouldApplyLdw(stateWithSpinsSince(4, EngagementPhase.RETENTION), () => 0)).toBe(true)
    // максимальный dither: 0.25+0.05 = 0.30 -> интервал 3
    expect(shouldApplyLdw(stateWithSpinsSince(1, EngagementPhase.RETENTION), () => 0.999_999)).toBe(
      false,
    )
    expect(shouldApplyLdw(stateWithSpinsSince(2, EngagementPhase.RETENTION), () => 0.999_999)).toBe(
      true,
    )
  })
})

describe('§8.1 воспроизводимость', () => {
  it('один seed даёт ровно ту же последовательность решений', () => {
    const first = runLdwSeries(
      EngagementPhase.RETENTION,
      SERIES_SPINS,
      createSeededRandom(20261015),
    )
    const second = runLdwSeries(
      EngagementPhase.RETENTION,
      SERIES_SPINS,
      createSeededRandom(20261015),
    )
    expect(first.decisions).toEqual(second.decisions)
    expect(first.frequency).toBe(second.frequency)

    const otherSeed = runLdwSeries(
      EngagementPhase.RETENTION,
      SERIES_SPINS,
      createSeededRandom(4242),
    )
    expect(otherSeed.decisions).not.toEqual(first.decisions)
  })

  it('selectLdwRow на той же игре и том же seed даёт те же строки', () => {
    const game = findLabGame('queenofbounty')
    const sequence = (seed: number): number[] => {
      const random = createSeededRandom(seed)
      const selected: number[] = []
      for (let index = 0; index < 100; index += 1) {
        const row = selectLdwRow(game, BET_TOTAL, random)
        selected.push(row === null ? -1 : houseRowPayout(row, game.payoutModel))
      }
      return selected
    }

    expect(sequence(9)).toEqual(sequence(9))
    expect(sequence(9)).not.toEqual(sequence(10))
    // На игре без кандидатов последовательность пуста при любом random:
    // воспроизводимость держится только на переданном RandomFn (не Math.random).
    const songkran = findLabGame('songkranparty')
    const anyValues = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.999_999]
    expect(payoutsOfSelected(songkran, anyValues)).toEqual(anyValues.map(() => -1))
  })
})

describe('§8.1 частота на длинной серии (2000 спинов)', () => {
  // Чередующийся random детерминирован, поэтому период считается аналитически;
  // допуск 0.02 оставлен как полоса биномиального шума (n=2000, p=0.25 ->
  // sigma ~ 0.0097), чтобы тест не лопнул при изменении порядка вызовов random.
  const tolerance = 0.02

  it('RETENTION: интервалы 5/3 чередуются -> ровно 1 LDW на 4 спина = 0.25', () => {
    const series = runLdwSeries(EngagementPhase.RETENTION, SERIES_SPINS, alternatingRandom())
    expect(series.frequency).toBeCloseTo(0.25, 6)
    expect(Math.abs(series.frequency - 0.25)).toBeLessThanOrEqual(tolerance)
    expect(new Set(series.gaps)).toEqual(new Set([4]))
  })

  it('ONBOARDING: интервалы 10/5 -> 1 LDW на 6 спинов ~ 0.167', () => {
    const series = runLdwSeries(EngagementPhase.ONBOARDING, SERIES_SPINS, alternatingRandom())
    // 2000 не делится на 6: 333 срабатывания, то есть 0.1665 против 0.1667.
    expect(series.fires).toBe(333)
    expect(Math.abs(series.frequency - 1 / 6)).toBeLessThan(0.001)
    expect(new Set(series.gaps)).toEqual(new Set([6]))
  })

  it('RISK: интервалы 4/3 -> 1 LDW на 4 спина = 0.25', () => {
    const series = runLdwSeries(EngagementPhase.RISK, SERIES_SPINS, alternatingRandom())
    expect(series.frequency).toBeCloseTo(0.25, 6)
    expect(new Set(series.gaps)).toEqual(new Set([4]))
  })

  it('REACTIVATION: интервалы 7/4 -> 1 LDW на 4 спина = 0.25', () => {
    const series = runLdwSeries(EngagementPhase.REACTIVATION, SERIES_SPINS, alternatingRandom())
    expect(series.frequency).toBeCloseTo(0.25, 6)
    expect(new Set(series.gaps)).toEqual(new Set([4]))
  })

  it('seeded random: RETENTION укладывается в критерий §13.4 0.25 +- 0.05', () => {
    const series = runLdwSeries(
      EngagementPhase.RETENTION,
      SERIES_SPINS,
      createSeededRandom(20261015),
    )
    const target = SIMULATION_SUCCESS_CRITERIA.ldwFrequencyTarget
    const band = SIMULATION_SUCCESS_CRITERIA.ldwFrequencyTolerance
    expect(Math.abs(series.frequency - target)).toBeLessThanOrEqual(band)
  })
})

describe('§8.1 selectLdwRow на боевых таблицах — честный замер окна 30-60 %', () => {
  it('Fortune Tiger: из 14 win-строк в окно попадает РОВНО ОДНА, на границе 0.60', () => {
    const game = findLabGame('fortunetiger')
    const payouts = winPayoutsOf(game)
    expect(payouts).toEqual([3, 30, 15, 15, 30, 4, 15, 30, 5, 250, 250, 50, 100, 100])
    expect(game.paylines).toBe(5)

    const ratios = payouts.map((payout) => winRatioOf(payout, game.paylines))
    expect(ratios).toEqual([0.6, 6, 3, 3, 6, 0.8, 3, 6, 1, 50, 50, 10, 20, 20])
    // Минимальный winRatio всей таблицы = 0.60: строк СТРОГО внутри окна нет.
    expect(Math.min(...ratios)).toBe(0.6)
    expect(ratios.filter((ratio) => ratio > 0.3 && ratio < 0.6)).toHaveLength(0)
    expect(candidateRatiosOf(game)).toEqual([0.6])

    // Ветка «включительно»: payout 3 = 0.60 — единственный кандидат.
    // При исключительной верхней границе окно Fortune Tiger было бы пустым.
    const selected = payoutsOfSelected(game, [0, 0.25, 0.5, 0.75, 0.999_999])
    expect(selected).toEqual([3, 3, 3, 3, 3])
  })

  it('Songkran Party: кандидатов нет вовсе, selectLdwRow возвращает null', () => {
    const game = findLabGame('songkranparty')
    const payouts = winPayoutsOf(game)
    expect(Math.min(...payouts)).toBe(30)
    expect(Math.min(...payouts.map((payout) => winRatioOf(payout, game.paylines)))).toBe(6)
    expect(candidateRatiosOf(game)).toEqual([])
    expect(payoutsOfSelected(game, [0, 0.5, 0.999_999])).toEqual([-1, -1, -1])
  })

  it('Queen of Bounty (20 линий, payoutModel lines): 36 строк из 620 в окне', () => {
    const game = findLabGame('queenofbounty')
    expect(game.payoutModel).toBe('lines')
    expect(game.paylines).toBe(20)
    const payouts = winPayoutsOf(game)
    expect(payouts).toHaveLength(620)

    const inWindow = payouts
      .map((payout) => winRatioOf(payout, game.paylines))
      .filter((ratio) => ratio >= 0.3 && ratio <= 0.6)
      .sort((left, right) => left - right)
    // Масштаб другой: здесь в окне реальные payouts 8 (0.40) x5, 10 (0.50) x29,
    // 12 (0.60) x2 = 36 строк; ниже окна лежат payouts 3, 4, 5 (0.15-0.25).
    expect(inWindow).toHaveLength(36)
    expect([...new Set(inWindow)].sort((left, right) => left - right)).toEqual([0.4, 0.5, 0.6])
    expect(candidateRatiosOf(game)).toHaveLength(36)

    const selected = payoutsOfSelected(game, [0, 0.3, 0.5, 0.7, 0.999_999])
    for (const payout of selected) {
      expect([8, 10, 12]).toContain(payout)
    }

    // Равновероятный выбор именно из списка кандидатов: random 0 -> первая
    // строка окна, 0.999... -> последняя; выплаты при этом могут совпадать
    // (крайние кандидаты обеих сторон платят 10), поэтому сверяем объекты строк.
    const candidateRows = game.winRows.filter(
      (row) =>
        winRatioOf(houseRowPayout(row, game.payoutModel), game.paylines) >= 0.3 &&
        winRatioOf(houseRowPayout(row, game.payoutModel), game.paylines) <= 0.6,
    )
    expect(candidateRows).toHaveLength(36)
    for (const value of [0, 0.3, 0.5, 0.7, 0.999_999]) {
      expect(selectLdwRow(game, BET_TOTAL, () => value)).toBe(
        candidateRows[Math.floor(value * candidateRows.length)],
      )
    }

    const spread = new Set<number>()
    for (let index = 0; index < 36; index += 1) {
      const row = selectLdwRow(game, BET_TOTAL, () => index / 36)
      expect(row).not.toBeNull()
      spread.add(houseRowPayout(row as TigerSpinRow, game.payoutModel))
    }
    expect([...spread].sort((left, right) => left - right)).toEqual([8, 10, 12])
  })

  it('нулевая ставка -> окно бессмысленно, возвращаем null', () => {
    const game = findLabGame('fortunetiger')
    expect(selectLdwRow(game, '0', steadyRandom)).toBeNull()
  })
})

describe('§8.1 selectLdwRow: границы окна 0.29 / 0.30 / 0.60 / 0.61', () => {
  const game = syntheticGame(100, [29, 30, 60, 61])

  it('0.30 и 0.60 включаются, 0.29 и 0.61 — нет', () => {
    expect(candidateRatiosOf(game)).toEqual([0.3, 0.6])
    expect(payoutsOfSelected(game, [0, 0.4, 0.5, 0.9, 0.999_999])).toEqual([30, 30, 60, 60, 60])
  })

  it('пустая таблица в окне -> null, а не исключение', () => {
    const outside = syntheticGame(100, [29, 61])
    expect(candidateRatiosOf(outside)).toEqual([])
    expect(selectLdwRow(outside, BET_TOTAL, steadyRandom)).toBeNull()
  })
})
