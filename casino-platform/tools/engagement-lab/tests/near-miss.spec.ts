import { describe, expect, it } from 'vitest'

import {
  houseRowPayout,
  TIGER_ROW_INDEX,
  type TigerSpinRow,
} from '../../../apps/api/src/modules/casino/domain/house-slot-game'
import { NEAR_MISS_CONFIG } from '../src/config'
import { EngagementPhase } from '../src/domain/engagement-phase'
import { type EngagementState, type LabGame, type NearMissSelection } from '../src/domain/types'
import {
  NEAR_MISS_PATTERN_PRIORITIES,
  classifySymbols,
  measureNearMissPatterns,
  nearMissCandidatesOf,
  selectNearMissRow,
  shouldApplyNearMiss,
  type NearMissPatternName,
} from '../src/engine/near-miss'
import { winRatioOf } from '../src/engine/spin-math'
import { createInitialState } from '../src/engine/state-transitions'
import { findLabGame, listLabGames } from '../src/game-data'
import { createSeededRandom } from '../src/rng'

const TRIALS = 20_000

const PATTERN_NAMES: readonly NearMissPatternName[] = [
  'jackpot_one_off',
  'bonus_adjacent',
  'high_value_almost',
]

const ALL_PHASES: readonly EngagementPhase[] = [
  EngagementPhase.ONBOARDING,
  EngagementPhase.RETENTION,
  EngagementPhase.RISK,
  EngagementPhase.REACTIVATION,
  EngagementPhase.COOLDOWN,
  EngagementPhase.DORMANT,
]

function stateAtPhase(phase: EngagementPhase, gameId = 'fortunetiger'): EngagementState {
  return {
    ...createInitialState({
      userId: 'player-1',
      gameId,
      sessionId: 'session-1',
      initialDeposit: '1000',
      startedAt: new Date(0),
    }),
    engagementPhase: phase,
  }
}

/** Прогон shouldApplyNearMiss через один и тот же seed: доля true. */
function frequencyOf(rate: number, phase: EngagementPhase): number {
  const random = createSeededRandom(20261015 + rate * 1000)
  const state = stateAtPhase(phase)
  let hits = 0
  for (let trial = 0; trial < TRIALS; trial++) {
    if (shouldApplyNearMiss(state, random)) {
      hits += 1
    }
  }
  return hits / TRIALS
}

/** Скриптовый random: детерминированная очередь чисел + счётчик вызовов. */
function scriptedRandom(values: readonly number[]): { random: () => number; calls: () => number } {
  let index = 0
  let calls = 0
  return {
    random: () => {
      calls += 1
      const value = values[index] ?? values[values.length - 1] ?? 0
      index += 1
      return value
    },
    calls: () => calls,
  }
}

function payoutOfRow(game: LabGame, row: TigerSpinRow): number {
  return houseRowPayout(row, game.payoutModel)
}

/** Строка донора 3x3: row-major, нумерация ячеек с 1 (как в active_icon). */
function tigerRow(args: {
  icons: string[]
  lineCells: number[]
  lineName: string
  linePayout: number
}): TigerSpinRow {
  return [
    args.icons,
    args.lineCells,
    [
      {
        index: 0,
        name: args.lineName,
        combine: args.lineCells.length,
        way_243: 1,
        payout: args.linePayout,
        multiply: 0,
        active_icon: args.lineCells,
      },
    ],
    [],
    1,
    args.linePayout,
  ]
}

describe('§8.2 shouldApplyNearMiss: частоты фаз', () => {
  it('COOLDOWN и DORMANT никогда не дают near-miss (§17) и не тратят random', () => {
    for (const phase of [EngagementPhase.COOLDOWN, EngagementPhase.DORMANT]) {
      const scripted = scriptedRandom([0, 0, 0, 0, 0, 0])
      const state = stateAtPhase(phase)
      for (let trial = 0; trial < 100; trial++) {
        expect(shouldApplyNearMiss(state, scripted.random)).toBe(false)
      }
      expect(scripted.calls()).toBe(0)
      expect(NEAR_MISS_CONFIG.rateByPhase[phase]).toBe(0)
    }
  })

  it('эмпирическая частота = rateByPhase с допуском ±2 %', () => {
    const activePhases = ALL_PHASES.filter(
      (phase) =>
        phase !== EngagementPhase.COOLDOWN &&
        phase !== EngagementPhase.DORMANT &&
        NEAR_MISS_CONFIG.rateByPhase[phase] > 0,
    )
    expect(activePhases.map((phase) => NEAR_MISS_CONFIG.rateByPhase[phase])).toEqual([
      0.1, 0.15, 0.2, 0.25,
    ])

    for (const phase of activePhases) {
      const target = NEAR_MISS_CONFIG.rateByPhase[phase]
      const measured = frequencyOf(target, phase)
      expect(Math.abs(measured - target)).toBeLessThan(0.02)
    }
  })

  it('dithering ±5 % двигает порог, а не только среднее', () => {
    const state = stateAtPhase(EngagementPhase.ONBOARDING)
    const dither = NEAR_MISS_CONFIG.ditherRange
    const baseRate = NEAR_MISS_CONFIG.rateByPhase[EngagementPhase.ONBOARDING]

    // random() = 0 => dither = -0.05 => порог 0.05: 0.06 не проходит, 0.04 проходит.
    const lowDither = scriptedRandom([0, 0.06])
    expect(shouldApplyNearMiss(state, lowDither.random)).toBe(false)
    const lowDitherHit = scriptedRandom([0, 0.04])
    expect(shouldApplyNearMiss(state, lowDitherHit.random)).toBe(true)

    // random() -> 1 => dither = +0.05 => порог 0.15.
    const highDither = scriptedRandom([0.999999, 0.14])
    expect(shouldApplyNearMiss(state, highDither.random)).toBe(true)

    // Ни один вызов не может дать порог выше baseRate + ditherRange.
    const aboveMax = scriptedRandom([0.999999, baseRate + dither + 0.000001])
    expect(shouldApplyNearMiss(state, aboveMax.random)).toBe(false)
    expect(aboveMax.calls()).toBe(2)
  })

  it('никакого Math.random: одинаковый seed даёт идентичную последовательность', () => {
    const runOnce = (seed: number): number[] => {
      const random = createSeededRandom(seed)
      const state = stateAtPhase(EngagementPhase.RISK)
      const decisions: number[] = []
      for (let trial = 0; trial < 500; trial++) {
        decisions.push(shouldApplyNearMiss(state, random) ? 1 : 0)
      }
      return decisions
    }
    expect(runOnce(31)).toEqual(runOnce(31))
    expect(runOnce(31)).not.toEqual(runOnce(32))
  })
})

describe('§8.2 selectNearMissRow на реальной таблице Fortune Tiger', () => {
  const game = findLabGame('fortunetiger')

  it('возвращает строку с winRatio < 2 и одним из трёх паттернов', () => {
    for (const phase of [
      EngagementPhase.ONBOARDING,
      EngagementPhase.RETENTION,
      EngagementPhase.RISK,
      EngagementPhase.REACTIVATION,
    ]) {
      const selection: NearMissSelection | null = selectNearMissRow(
        game,
        stateAtPhase(phase),
        () => 0.5,
      )
      expect(selection).not.toBeNull()
      if (!selection) {
        continue
      }
      expect(PATTERN_NAMES).toContain(selection.pattern as NearMissPatternName)
      expect(game.winRows).toContain(selection.row)
      const ratio = winRatioOf(payoutOfRow(game, selection.row), game.paylines)
      expect(ratio).toBeLessThan(NEAR_MISS_CONFIG.maxPayoutMultiplier)
      expect(ratio).toBeGreaterThan(0)
    }
  })

  it('в COOLDOWN и DORMANT не отдаёт строку даже при готовых кандидатах (§17)', () => {
    expect(nearMissCandidatesOf(game).length).toBeGreaterThan(0)
    for (const phase of [EngagementPhase.COOLDOWN, EngagementPhase.DORMANT]) {
      expect(selectNearMissRow(game, stateAtPhase(phase), () => 0.5)).toBeNull()
    }
  })

  it('тот же seed -> та же строка и тот же паттерн', () => {
    const pick = (seed: number): string => {
      const random = createSeededRandom(seed)
      const state = stateAtPhase(EngagementPhase.REACTIVATION)
      const chosen = selectNearMissRow(game, state, random)
      return chosen
        ? `${chosen.pattern}:${chosen.row[TIGER_ROW_INDEX.slotIcons].join('|')}`
        : 'null'
    }
    expect(pick(4242)).toBe(pick(4242))
    expect(pick(4242)).not.toBe('null')
  })
})

describe('§8.2 приоритеты паттернов', () => {
  it('числа приоритетов — из ТЗ §8.2', () => {
    expect(NEAR_MISS_PATTERN_PRIORITIES).toEqual({
      jackpot_one_off: 10,
      bonus_adjacent: 8,
      high_value_almost: 5,
    })
  })

  it('jackpot_one_off выбирается, даже если есть кандидаты дешевле', () => {
    const real = findLabGame('fortunetiger')
    // Барабан 2 (индексы 3,4,5) — линия [4,5,6]: два Symbol_0 (джекпот Tiger) на
    // линии, третий Symbol_0 на строку ниже (индекс 8) там, где на линии Symbol_1.
    const jackpotRow = tigerRow({
      icons: [
        'Symbol_6',
        'Symbol_6',
        'Symbol_6',
        'Symbol_0',
        'Symbol_0',
        'Symbol_1',
        'Symbol_7',
        'Symbol_7',
        'Symbol_0',
      ],
      lineCells: [1, 2, 3],
      lineName: 'Symbol_6',
      linePayout: 3,
    })
    const game: LabGame = { ...real, winRows: [jackpotRow, ...real.winRows] }

    const selection = selectNearMissRow(game, stateAtPhase(EngagementPhase.RISK), () => 0)
    expect(selection?.pattern).toBe('jackpot_one_off')
    expect(selection?.row).toEqual(jackpotRow)

    const patterns = nearMissCandidatesOf(game)
      .filter((candidate) => candidate.row === jackpotRow)
      .map((candidate) => candidate.pattern)
    expect(patterns).toContain('jackpot_one_off')
    expect(patterns).toContain('high_value_almost')
  })

  it('bonus_adjacent сильнее high_value_almost и работает, когда bonus-символ объявлен', () => {
    const real = findLabGame('fortunetiger')
    // Выигрышная линия — нижний ряд; над ней Symbol_5 (маркер wild => bonus) и
    // Symbol_1 (верхний квартиль paytable => high-value). Приоритет 8 > 5.
    const bonusRow = tigerRow({
      icons: [
        'Symbol_3',
        'Symbol_3',
        'Symbol_8',
        'Symbol_1',
        'Symbol_5',
        'Symbol_8',
        'Symbol_7',
        'Symbol_7',
        'Symbol_7',
      ],
      lineCells: [7, 8, 9],
      lineName: 'Symbol_7',
      linePayout: 3,
    })
    const bonusIcons = {
      ...real.paytable,
      data: real.paytable.data.map((icon) =>
        icon.icon_name === 'Symbol_5' ? { ...icon, wild_card: 1 } : icon,
      ),
    }
    const game: LabGame = { ...real, winRows: [bonusRow], paytable: bonusIcons }

    expect(classifySymbols(game).bonus).toEqual(['Symbol_5'])
    const candidates = nearMissCandidatesOf(game)
    expect(candidates.map((candidate) => candidate.pattern)).toEqual([
      'bonus_adjacent',
      'high_value_almost',
    ])

    const selection = selectNearMissRow(game, stateAtPhase(EngagementPhase.ONBOARDING), () => 0)
    expect(selection?.pattern).toBe('bonus_adjacent')
    expect(selection?.row).toEqual(bonusRow)
  })

  it('равный приоритет решается равномерно через random, без Math.random', () => {
    const real = findLabGame('fortunetiger')
    // Выигрышная линия — средний ряд [4,5,6]; над ней Symbol_0 / Symbol_1,
    // оба в верхнем квартиле paytable => два кандидата одного приоритета 5.
    const almostRow = (neighbor: string): TigerSpinRow =>
      tigerRow({
        icons: [
          neighbor,
          'Symbol_3',
          'Symbol_3',
          'Symbol_6',
          'Symbol_6',
          'Symbol_6',
          'Symbol_8',
          'Symbol_8',
          'Symbol_8',
        ],
        lineCells: [4, 5, 6],
        lineName: 'Symbol_6',
        linePayout: 3,
      })
    const first = almostRow('Symbol_0')
    const second = almostRow('Symbol_1')
    const game: LabGame = { ...real, winRows: [first, second] }

    expect(selectNearMissRow(game, stateAtPhase(EngagementPhase.RISK), () => 0)?.row).toEqual(first)
    expect(selectNearMissRow(game, stateAtPhase(EngagementPhase.RISK), () => 0.999)?.row).toEqual(
      second,
    )
  })
})

describe('§8.2 near-miss не удовлетворим', () => {
  it('нет кандидатов -> null, и random не тратится', () => {
    const real = findLabGame('fortunetiger')
    const quietRow = tigerRow({
      icons: [
        'Symbol_8',
        'Symbol_8',
        'Symbol_8',
        'Symbol_8',
        'Symbol_7',
        'Symbol_8',
        'Symbol_7',
        'Symbol_7',
        'Symbol_7',
      ],
      lineCells: [7, 8, 9],
      lineName: 'Symbol_7',
      linePayout: 3,
    })
    const game: LabGame = { ...real, winRows: [quietRow] }
    expect(nearMissCandidatesOf(game)).toEqual([])

    const scripted = scriptedRandom([0.5])
    expect(
      selectNearMissRow(game, stateAtPhase(EngagementPhase.REACTIVATION), scripted.random),
    ).toBeNull()
    expect(scripted.calls()).toBe(0)
  })

  it('строка вне окна выплаты (winRatio >= 2) в кандидаты не попадает (§17)', () => {
    const real = findLabGame('fortunetiger')
    const bigRow = tigerRow({
      icons: [
        'Symbol_0',
        'Symbol_0',
        'Symbol_1',
        'Symbol_0',
        'Symbol_7',
        'Symbol_7',
        'Symbol_7',
        'Symbol_7',
        'Symbol_7',
      ],
      lineCells: [1, 2, 3],
      lineName: 'Symbol_0',
      linePayout: 250,
    })
    const game: LabGame = { ...real, winRows: [bigRow] }
    expect(winRatioOf(payoutOfRow(game, bigRow), game.paylines)).toBeGreaterThanOrEqual(
      NEAR_MISS_CONFIG.maxPayoutMultiplier,
    )
    expect(nearMissCandidatesOf(game)).toEqual([])
  })
})

describe('§8.2 честные числа кандидатов на боевых таблицах', () => {
  it('геометрия донора: ячейки row-major, линия = по одной ячейке с барабана', () => {
    const violations: string[] = []
    for (const game of listLabGames()) {
      const measurement = measureNearMissPatterns(game)
      for (const row of [...game.winRows, ...game.loseRows]) {
        const icons = row[TIGER_ROW_INDEX.slotIcons]
        if (icons.length !== measurement.gridCells) {
          violations.push(`${game.externalGameId}: разная длина сетки ${icons.length}`)
          continue
        }
        for (const line of row[TIGER_ROW_INDEX.activeLines]) {
          const reels = new Set(line.active_icon.map((cell) => (cell - 1) % measurement.reels))
          if (reels.size !== line.active_icon.length) {
            violations.push(`${game.externalGameId}: линия ${line.active_icon.join(',')} в столбце`)
          }
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('бонус-символов в боевых paytable нет: bonus_adjacent даёт 0 кандидатов', () => {
    for (const game of listLabGames()) {
      const measurement = measureNearMissPatterns(game)
      expect(measurement.bonusSymbols).toEqual([])
      expect(measurement.bonusAdjacentRows).toBe(0)
    }
  })

  it('замер по каждой игре: окно выплаты и число строк под каждый паттерн', () => {
    const summary: Record<string, number[]> = {}
    for (const game of listLabGames()) {
      const measurement = measureNearMissPatterns(game)
      // winRows | окно winRatio<2 | jackpot_one_off | джекпот «2 из 3 на линии» |
      // bonus_adjacent | high_value_almost | строки с любым паттерном | кандидаты
      summary[measurement.gameId] = [
        measurement.winRows,
        measurement.rowsInPayoutWindow,
        measurement.jackpotOneOffRows,
        measurement.jackpotNearLineRows,
        measurement.bonusAdjacentRows,
        measurement.highValueAlmostRows,
        measurement.rowsMatchingAnyPattern,
        measurement.selectableCandidates,
      ]
    }

    expect(summary).toEqual({
      fortunetiger: [14, 3, 0, 0, 0, 3, 3, 3],
      fortuneox: [7, 3, 0, 2, 0, 2, 2, 2],
      fortunemouse: [14, 3, 0, 2, 0, 2, 2, 2],
      fortunepanda: [7, 3, 0, 2, 0, 2, 2, 2],
      fortunerabbit: [14, 3, 0, 2, 0, 2, 2, 2],
      hoodvswoolf: [14, 3, 0, 2, 0, 2, 2, 2],
      jackfrost: [14, 3, 0, 2, 0, 2, 2, 2],
      phoenixrises: [14, 3, 0, 2, 0, 2, 2, 2],
      songkranparty: [7, 0, 0, 0, 0, 0, 0, 0],
      bikiniparadise: [7, 3, 0, 2, 0, 2, 2, 2],
      queenofbounty: [620, 195, 0, 1, 0, 133, 133, 133],
    })
  })

  it('главная находка: jackpot_one_off на боевых таблицах не удовлетворим (N=0)', () => {
    const totals = listLabGames().reduce(
      (acc, game) => {
        const measurement = measureNearMissPatterns(game)
        return {
          jackpotOneOff: acc.jackpotOneOff + measurement.jackpotOneOffRows,
          jackpotNearLine: acc.jackpotNearLine + measurement.jackpotNearLineRows,
          bonus: acc.bonus + measurement.bonusAdjacentRows,
          highValue: acc.highValue + measurement.highValueAlmostRows,
          selectable: acc.selectable + measurement.selectableCandidates,
        }
      },
      { jackpotOneOff: 0, jackpotNearLine: 0, bonus: 0, highValue: 0, selectable: 0 },
    )

    // Линия «джекпот минус одна ячейка» в таблицах есть (17 строк на 11 играх),
    // но третий Jackpot рядом с пропуском не встаёт ни разу => паттерн
    // приоритета 10 на боевых данных мёртв.
    expect(totals).toEqual({
      jackpotOneOff: 0,
      jackpotNearLine: 17,
      bonus: 0,
      highValue: 152,
      selectable: 152,
    })
  })

  it('Fortune Tiger: три кандидата — это строки с payout 3, 4 и 5 (winRatio 0.6/0.8/1.0)', () => {
    const game = findLabGame('fortunetiger')
    const candidates = nearMissCandidatesOf(game)
    expect(candidates.map((candidate) => payoutOfRow(game, candidate.row)).sort()).toEqual([
      3, 4, 5,
    ])
    expect(candidates.map((candidate) => candidate.pattern)).toEqual([
      'high_value_almost',
      'high_value_almost',
      'high_value_almost',
    ])
    for (const candidate of candidates) {
      expect(winRatioOf(payoutOfRow(game, candidate.row), game.paylines)).toBeLessThan(
        NEAR_MISS_CONFIG.maxPayoutMultiplier,
      )
    }
  })

  it('Songkran Party: окно выплаты пусто на реальных данных -> selectNearMissRow = null', () => {
    const game = findLabGame('songkranparty')
    const minimalRatio = Math.min(
      ...game.winRows.map((row) => winRatioOf(payoutOfRow(game, row), game.paylines)),
    )
    expect(minimalRatio).toBeGreaterThanOrEqual(NEAR_MISS_CONFIG.maxPayoutMultiplier)
    for (const phase of ALL_PHASES.filter((candidate) => candidate !== EngagementPhase.DORMANT)) {
      const state = stateAtPhase(phase, game.externalGameId)
      expect(selectNearMissRow(game, state, () => 0.5)).toBeNull()
    }
  })
})
