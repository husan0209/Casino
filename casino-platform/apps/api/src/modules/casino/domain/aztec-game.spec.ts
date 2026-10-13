import { describe, expect, it } from 'vitest'

import {
  AZTEC_FREE_SPINS,
  AZTEC_MAX_WIN_MULTIPLIER,
  AZTEC_PAYTABLE,
  AZTEC_REEL_ROWS,
  AZTEC_TIERS,
  buildAztecGrid,
  evaluateAztecGrid,
  playAztecSpin,
  type AztecSpin,
  type AztecSymbol,
} from './aztec-game'

/** Детерминированный rng: статистика теста воспроизводится, а не «повезло». */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

const SAMPLE = 300000
const SAMPLE_TIMEOUT = 120000

interface Stats {
  rtp: number
  hitRate: number
  freeSpinRate: number
  maxWin: number
}

function sampleSpins(count: number, seed: number): AztecSpin[] {
  const rng = mulberry32(seed)
  const spins: AztecSpin[] = []
  for (let index = 0; index < count; index += 1) {
    spins.push(playAztecSpin(rng))
  }
  return spins
}

function stats(spins: AztecSpin[]): Stats {
  let payoutSum = 0
  let wins = 0
  let freeSpins = 0
  let max = 0
  for (const spin of spins) {
    payoutSum += spin.payout
    if (spin.payout > 0) {
      wins += 1
    }
    if (spin.freeSpinsPlayed > 0) {
      freeSpins += 1
    }
    if (spin.payout > max) {
      max = spin.payout
    }
  }
  return {
    rtp: (payoutSum / spins.length) * 100,
    hitRate: wins / spins.length,
    freeSpinRate: freeSpins / spins.length,
    maxWin: max,
  }
}

function wildCount(grid: AztecSymbol[][], reel: number): number {
  return grid[reel]?.filter((cell) => cell === 'W').length ?? -1
}

describe('азтек: доска', () => {
  it('шесть барабанов: 1 и 6 по пять ячеек, 2–5 по шесть', () => {
    const grid = buildAztecGrid(mulberry32(1))

    expect(grid.map((cells) => cells.length)).toEqual([...AZTEC_REEL_ROWS])
    expect(AZTEC_REEL_ROWS.reduce((acc, rows) => acc + rows, 0)).toBe(34)
  })

  it('Wilds-on-the-Way: на крайних барабанах дикие есть всегда, на средних — нет', () => {
    const rng = mulberry32(7)
    for (let spin = 0; spin < 200; spin += 1) {
      const grid = buildAztecGrid(rng)

      expect(wildCount(grid, 0)).toBeGreaterThan(0)
      expect(wildCount(grid, 5)).toBeGreaterThan(0)
      for (const reel of [1, 2, 3, 4]) {
        expect(grid[reel]?.includes('W')).toBe(false)
      }
    }
  })
})

describe('азтек: оценка связки', () => {
  it('платит одна лучшая группа, а не сумма подошедших', () => {
    // Пять барабанов подряд: J собирает 15 совпадений (3.9×), M — 14 (26×).
    const grid: AztecSymbol[][] = [
      ['J', 'J', 'J', 'M', 'M'],
      ['J', 'J', 'J', 'M', 'M', 'M'],
      ['J', 'J', 'J', 'M', 'M', 'M'],
      ['J', 'J', 'J', 'M', 'M', 'M'],
      ['J', 'J', 'J', 'M', 'M', 'M'],
      ['G', 'G', 'G', 'G', 'G'],
    ]

    const evaluated = evaluateAztecGrid(grid)

    expect(evaluated.symbol).toBe('M')
    expect(evaluated.match).toBe(14)
    expect(evaluated.reels).toBe(5)
    expect(evaluated.payout).toBe(AZTEC_PAYTABLE.M[0])
    expect(AZTEC_PAYTABLE.J[1]).toBeGreaterThan(0)
  })

  it('связка короче трёх барабанов не платит', () => {
    const grid: AztecSymbol[][] = [
      ['J', 'J', 'J', 'J', 'J'],
      ['J', 'J', 'J', 'J', 'J', 'J'],
      ['G', 'G', 'G', 'G', 'G', 'G'],
      ['G', 'G', 'G', 'G', 'G', 'G'],
      ['G', 'G', 'G', 'G', 'G', 'G'],
      ['G', 'G', 'G', 'G', 'G'],
    ]

    expect(evaluateAztecGrid(grid).payout).toBe(0)
  })

  it('порог выбирается по числу собранных символов, а не по числу барабанов', () => {
    // M: 5+5+5+5 = 20 совпадений на четырёх барабанах → порог 20
    const grid: AztecSymbol[][] = [
      ['M', 'M', 'M', 'M', 'M'],
      ['M', 'M', 'M', 'M', 'M', 'J'],
      ['M', 'M', 'M', 'M', 'M', 'J'],
      ['M', 'M', 'M', 'M', 'M', 'J'],
      ['J', 'J', 'J', 'J', 'J', 'J'],
      ['J', 'J', 'J', 'J', 'J'],
    ]

    const evaluated = evaluateAztecGrid(grid)

    expect(evaluated.match).toBe(20)
    expect(evaluated.reels).toBe(4)
    expect(AZTEC_TIERS[2]).toBe(20)
    expect(evaluated.payout).toBe(AZTEC_PAYTABLE.M[2])
  })

  it('дикий на крайнем барабане засчитывается любому символу и решает исход', () => {
    // Те же барабаны 2–3; на первом два J заменены на диких.
    const plain: AztecSymbol[][] = [
      ['M', 'M', 'M', 'J', 'J'],
      ['M', 'M', 'M', 'M', 'J', 'J'],
      ['M', 'M', 'M', 'M', 'J', 'J'],
      ['G', 'G', 'G', 'G', 'G', 'G'],
      ['G', 'G', 'G', 'G', 'G', 'G'],
      ['G', 'G', 'G', 'G', 'G'],
    ]
    const boosted = plain.map((cells) => [...cells])
    boosted[0] = ['M', 'M', 'W', 'W', 'J']

    const plainResult = evaluateAztecGrid(plain)
    const boostedResult = evaluateAztecGrid(boosted)

    // 11 совпадений M — ниже первого порога, и победителя нет вовсе
    expect(plainResult.payout).toBe(0)
    expect(plainResult.symbol).toBeNull()
    expect(boostedResult.match).toBe(12)
    expect(boostedResult.symbol).toBe('M')
    expect(boostedResult.payout).toBe(AZTEC_PAYTABLE.M[0])
  })
})

describe('азтек: деньги и инварианты спина', () => {
  it(
    'выплата не выходит за потолок и равна сумме шагов цепочки',
    () => {
      const rng = mulberry32(4242)
      for (let spin = 0; spin < 20000; spin += 1) {
        const result = playAztecSpin(rng)

        expect(result.payout).toBeGreaterThanOrEqual(0)
        expect(result.payout).toBeLessThanOrEqual(AZTEC_MAX_WIN_MULTIPLIER)
        if (result.capped) {
          continue
        }
        const parts = [...result.steps, ...result.freeSteps].reduce(
          (acc, step) => acc + step.payout,
          0,
        )
        expect(Math.abs(parts - result.payout)).toBeLessThan(1e-6)
      }
    },
    SAMPLE_TIMEOUT,
  )

  it(
    'фриспины начинаются с множителя ×3 и дают минимум десять игр',
    () => {
      const withFree = sampleSpins(SAMPLE, 20261013).filter((spin) => spin.freeSpinsPlayed > 0)
      const first = withFree[0]

      expect(first).toBeDefined()
      expect(first?.freeSpinsPlayed).toBeGreaterThanOrEqual(AZTEC_FREE_SPINS)
      expect(first?.freeSteps[0]?.multiplier).toBe(3)
    },
    SAMPLE_TIMEOUT,
  )
})

describe('азтек: RTP калибровки', () => {
  const measured = stats(sampleSpins(SAMPLE, 20261013))

  it('отдача держится у заявленных 96%', () => {
    expect(measured.rtp).toBeGreaterThan(93)
    expect(measured.rtp).toBeLessThan(97.5)
  })

  it('доля выигрышных спинов и частота фриспинов — в норме жанра', () => {
    expect(measured.hitRate).toBeGreaterThan(0.19)
    expect(measured.hitRate).toBeLessThan(0.27)
    expect(measured.freeSpinRate).toBeGreaterThan(1 / 800)
    expect(measured.freeSpinRate).toBeLessThan(1 / 150)
  })

  it('на другом сиде статистика не уезжает', () => {
    const other = stats(sampleSpins(SAMPLE, 987654321))

    expect(Math.abs(other.rtp - measured.rtp)).toBeLessThan(4)
    expect(Math.abs(other.hitRate - measured.hitRate)).toBeLessThan(0.02)
  })
})
