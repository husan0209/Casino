/**
 * Treasures of Aztec — игра house-оригинала с собственной математикой.
 *
 * Из донора ViperPro эта игра не переносится: его строки исхода описывают доску
 * 15 ячеек (геометрия Queen of Bounty), а клиент игры — 6 барабанов × 5 рядов с
 * верхним рядом на 2–5 и механикой Wilds-on-the-Way. Поэтому здесь движок написан
 * заново: доска 34 ячейки, выплаты по числу собранных символов, каскады с растущим
 * множителем, фриспины с ретриггером.
 *
 * Деньги: движок оперирует МНОЖИТЕЛЯМИ ставки (`payout` — во сколько раз ставка).
 * Ставка и выплата считаются money/Decimal в use-case, здесь арифметики денег нет.
 *
 * Параметры откалиброваны прогоном Монте-Карло (aztec-game.spec.ts): RTP 96.0%,
 * доля выигрышных спинов 23.0%, фриспины 1 из ~292, максимальный выигрыш
 * наблюдения 160× при потолке ×1000.
 */

export type AztecPaySymbol = 'J' | 'Q' | 'K' | 'A' | 'F' | 'B' | 'G' | 'M'
export type AztecSymbol = AztecPaySymbol | 'W' | 'T'

/** Позиции барабана сверху вниз; барабаны 1 и 6 по пять ячеек, 2–5 по шесть. */
export const AZTEC_REEL_ROWS: readonly number[] = [5, 6, 6, 6, 6, 5]
export const AZTEC_PAY_SYMBOLS: readonly AztecPaySymbol[] = ['J', 'Q', 'K', 'A', 'F', 'B', 'G', 'M']
export const AZTEC_WILD: AztecSymbol = 'W'
export const AZTEC_SCATTER: AztecSymbol = 'T'

/**
 * Состав стрипа: сколько экземпляров символа на барабане. Выборка идёт без
 * повторов внутри барабана, поэтому плотность связки задаётся именно здесь.
 */
export const AZTEC_STOP_COUNTS: Record<AztecSymbol, readonly number[]> = {
  J: [8, 8, 8, 8, 8, 8],
  Q: [7, 7, 7, 7, 7, 7],
  K: [6, 6, 6, 6, 6, 6],
  A: [5, 5, 5, 5, 5, 5],
  F: [4, 4, 4, 4, 4, 4],
  B: [3, 3, 3, 4, 4, 3],
  G: [2, 3, 3, 3, 3, 2],
  M: [2, 2, 2, 2, 2, 2],
  W: [0, 0, 0, 0, 0, 0],
  T: [1, 1, 1, 1, 1, 1],
}

/** Порог — число собранных символов на соседних барабанах слева. */
export const AZTEC_TIERS: readonly number[] = [12, 15, 20, 25, 30, 34, 40]
export const AZTEC_MIN_REELS = 3

export const AZTEC_PAYTABLE: Record<AztecPaySymbol, readonly number[]> = {
  J: [2.6, 3.9, 6.5, 10.4, 19.5, 39, 78],
  Q: [3.25, 5.2, 9.1, 15.6, 26, 52, 104],
  K: [3.9, 6.5, 11.7, 19.5, 32.5, 65, 130],
  A: [5.2, 7.8, 14.3, 23.4, 39, 78, 156],
  F: [7.8, 13, 23.4, 39, 65, 130, 260],
  B: [10.4, 18.2, 32.5, 52, 91, 182, 364],
  G: [15.6, 26, 45.5, 78, 130, 260, 520],
  M: [26, 41.6, 71.5, 117, 195, 390, 780],
}

export const AZTEC_SCATTER_PAY: readonly number[] = [1, 4, 15]
export const AZTEC_SCATTER_MIN = 4
export const AZTEC_FREE_SPINS = 10
/** 3+ скаттера внутри фриспина додают ещё пять заходов. */
export const AZTEC_FREE_RETRIGGER = 5
export const AZTEC_FREE_RETRIGGER_MIN = 3
export const AZTEC_FREE_SPINS_HARD_LIMIT = 60
export const AZTEC_MAX_CASCADES = 12
export const AZTEC_MAX_MULTIPLIER_BASE = 5
export const AZTEC_MAX_MULTIPLIER_FREE = 15
export const AZTEC_MAX_WIN_MULTIPLIER = 1000
/** Дикий может прилететь в досыпку на крайнем барабане. */
export const AZTEC_REFILL_WILD_CHANCE = 0.35

/** Один шаг цепочки: доска ДО розыгрыша и то, что на ней дало выплату. */
// type, а не interface: значение кладётся в prisma metadata, а индексы у
// interface TS не считает совместимыми с InputJsonObject.
export type AztecChainStep = {
  grid: AztecSymbol[][]
  symbol: AztecPaySymbol | null
  match: number
  reels: number
  multiplier: number
  payout: number
}

export interface AztecEvaluation {
  payout: number
  symbol: AztecPaySymbol | null
  match: number
  reels: number
  removed: boolean[][]
}

export interface AztecChainResult {
  steps: AztecChainStep[]
  payout: number
  capped: boolean
}

export interface AztecSpin {
  steps: AztecChainStep[]
  freeSteps: AztecChainStep[]
  freeSpinsPlayed: number
  payout: number
  capped: boolean
}

/** Множитель каскадов: старт, шаг прироста и потолок. */
interface MultiplierPolicy {
  start: number
  step: number
  cap: number
}

const BASE_MULTIPLIER: MultiplierPolicy = {
  start: 1,
  step: 1,
  cap: AZTEC_MAX_MULTIPLIER_BASE,
}

const FREE_MULTIPLIER: MultiplierPolicy = {
  start: 3,
  step: 2,
  cap: AZTEC_MAX_MULTIPLIER_FREE,
}

const STRIP_SYMBOLS: readonly AztecSymbol[] = [...AZTEC_PAY_SYMBOLS, AZTEC_WILD, AZTEC_SCATTER]

/**
 * Стрипы барабанов. Порядок остановов не важен: выборка равномерна по индексу,
 * поэтому перемешивания здесь нет намеренно.
 */
const STRIPS: readonly (readonly AztecSymbol[])[] = AZTEC_REEL_ROWS.map((_, reel) => {
  const stops: AztecSymbol[] = []
  for (const symbol of STRIP_SYMBOLS) {
    const perReel = AZTEC_STOP_COUNTS[symbol][reel] ?? 0
    for (let count = 0; count < perReel; count += 1) {
      stops.push(symbol)
    }
  }
  return stops
})

function stripOf(reel: number): readonly AztecSymbol[] {
  return STRIPS[reel] ?? []
}

function pickFromStrip(reel: number, rng: () => number): AztecSymbol {
  const stops = stripOf(reel)
  return stops[Math.floor(rng() * stops.length)] ?? 'J'
}

/**
 * Wilds-on-the-Way: на крайних барабанах стопка из 1–3 диких подряд. Ковёр диких
 * по всему барабану обесценил бы пороги выплат.
 */
function placeWilds(cells: AztecSymbol[], rng: () => number): void {
  const roll = rng()
  const count = roll < 0.55 ? 1 : roll < 0.88 ? 2 : 3
  const start = Math.floor(rng() * (cells.length - count + 1))
  for (let offset = 0; offset < count; offset += 1) {
    cells[start + offset] = AZTEC_WILD
  }
}

export function buildAztecGrid(rng: () => number): AztecSymbol[][] {
  return AZTEC_REEL_ROWS.map((rows, reel) => {
    const stops = stripOf(reel)
    const taken = new Set<number>()
    const cells: AztecSymbol[] = []
    while (cells.length < rows) {
      const index = Math.floor(rng() * stops.length)
      if (taken.has(index)) {
        continue
      }
      taken.add(index)
      const stop = stops[index]
      if (stop) {
        cells.push(stop)
      }
    }
    if (reel === 0 || reel === AZTEC_REEL_ROWS.length - 1) {
      placeWilds(cells, rng)
    }
    return cells
  })
}

function tierPayout(symbol: AztecPaySymbol, match: number): number {
  const table = AZTEC_PAYTABLE[symbol]
  let payout = 0
  for (let tier = 0; tier < AZTEC_TIERS.length; tier += 1) {
    const threshold = AZTEC_TIERS[tier]
    const value = table[tier]
    if (threshold !== undefined && value !== undefined && match >= threshold) {
      payout = value
    }
  }
  return payout
}

function countScatters(grid: AztecSymbol[][]): number {
  return grid.reduce((acc, cells) => acc + cells.filter((cell) => cell === AZTEC_SCATTER).length, 0)
}

function scatterPayout(scatters: number): number {
  if (scatters < AZTEC_SCATTER_MIN) {
    return 0
  }
  return AZTEC_SCATTER_PAY[Math.min(scatters, 6) - AZTEC_SCATTER_MIN] ?? 0
}

/**
 * Оценка доски. Платит ОДНА лучшая символьная группа: при восьми символах на
 * 34 ячейках «хотя бы одна связка из трёх барабанов» почти достоверна, и выплата
 * по всем группам сразу дала бы выигрыш на 99% спинов.
 */
export function evaluateAztecGrid(grid: AztecSymbol[][]): AztecEvaluation {
  let best: AztecEvaluation = {
    payout: 0,
    symbol: null,
    match: 0,
    reels: 0,
    removed: grid.map((cells) => cells.map(() => false)),
  }

  for (const symbol of AZTEC_PAY_SYMBOLS) {
    let match = 0
    let reels = 0
    const hits: [number, number][] = []
    for (let reel = 0; reel < grid.length; reel += 1) {
      const cells = grid[reel] ?? []
      const reelHits: number[] = []
      cells.forEach((cell, position) => {
        if (cell === symbol || cell === AZTEC_WILD) {
          reelHits.push(position)
        }
      })
      if (reelHits.length === 0) {
        break
      }
      match += reelHits.length
      reels += 1
      reelHits.forEach((position) => hits.push([reel, position]))
    }
    const payout = reels >= AZTEC_MIN_REELS ? tierPayout(symbol, match) : 0
    if (payout <= best.payout) {
      continue
    }
    const removed = grid.map((cells) => cells.map(() => false))
    hits.forEach(([reel, position]) => {
      const marks = removed[reel]
      if (marks) {
        marks[position] = true
      }
    })
    best = { payout, symbol, match, reels, removed }
  }

  return best
}

/** Выигравшие ячейки исчезают, остальные падают вниз, сверху досыпается новое. */
function collapseGrid(
  grid: AztecSymbol[][],
  removed: boolean[][],
  rng: () => number,
): AztecSymbol[][] {
  return grid.map((cells, reel) => {
    const marks = removed[reel] ?? []
    const kept = cells.filter((_, position) => marks[position] !== true)
    const fresh: AztecSymbol[] = []
    for (let missing = cells.length - kept.length; missing > 0; missing -= 1) {
      fresh.push(pickFromStrip(reel, rng))
    }
    const edge = reel === 0 || reel === grid.length - 1
    if (edge && fresh.length > 0 && rng() < AZTEC_REFILL_WILD_CHANCE) {
      fresh[Math.floor(rng() * fresh.length)] = AZTEC_WILD
    }
    return [...fresh, ...kept]
  })
}

/**
 * Цепочка каскадов одной игры — базовой или одного фриспина.
 *
 * Выплата скаттеров только на первом шаге: на каждом каскаде она превращается в
 * надбавку, не зависящую от платёжной таблицы, и хвост распределения переставал
 * калиброваться (это и ловилось на прототипе).
 */
function runChain(
  grid: AztecSymbol[][],
  rng: () => number,
  policy: MultiplierPolicy,
): AztecChainResult {
  const steps: AztecChainStep[] = []
  let payout = 0
  let multiplier = policy.start
  let current = grid

  for (let cascade = 0; cascade < AZTEC_MAX_CASCADES; cascade += 1) {
    const evaluated = evaluateAztecGrid(current)
    const win = evaluated.payout + (cascade === 0 ? scatterPayout(countScatters(current)) : 0)
    if (win <= 0) {
      break
    }
    const stepPayout = win * multiplier
    payout += stepPayout
    steps.push({
      grid: current.map((cells) => [...cells]),
      symbol: evaluated.symbol,
      match: evaluated.match,
      reels: evaluated.reels,
      multiplier,
      payout: stepPayout,
    })
    if (payout >= AZTEC_MAX_WIN_MULTIPLIER) {
      return { steps, payout: AZTEC_MAX_WIN_MULTIPLIER, capped: true }
    }
    current = collapseGrid(current, evaluated.removed, rng)
    multiplier = Math.min(multiplier + policy.step, policy.cap)
  }

  return { steps, payout, capped: false }
}

function playFreeSpins(rng: () => number): AztecChainResult & { spinsPlayed: number } {
  const merged: AztecChainStep[] = []
  let payout = 0
  let capped = false
  let budget = AZTEC_FREE_SPINS
  let spinsPlayed = 0

  while (budget > 0 && spinsPlayed < AZTEC_FREE_SPINS_HARD_LIMIT) {
    const grid = buildAztecGrid(rng)
    const chain = runChain(grid, rng, FREE_MULTIPLIER)
    merged.push(...chain.steps)
    payout += chain.payout
    budget -= 1
    spinsPlayed += 1
    if (countScatters(grid) >= AZTEC_FREE_RETRIGGER_MIN) {
      budget += AZTEC_FREE_RETRIGGER
    }
    if (chain.capped) {
      capped = true
      break
    }
  }

  return { steps: merged, payout, capped, spinsPlayed }
}

/** Один спин целиком: база с каскадами и фриспины, если они триггернулись. */
export function playAztecSpin(rng: () => number): AztecSpin {
  const grid = buildAztecGrid(rng)
  const triggered = countScatters(grid) >= AZTEC_SCATTER_MIN
  const base = runChain(grid, rng, BASE_MULTIPLIER)
  const idle: AztecChainResult & { spinsPlayed: number } = {
    steps: [],
    payout: 0,
    capped: false,
    spinsPlayed: 0,
  }
  const free = triggered ? playFreeSpins(rng) : idle

  const total = base.payout + free.payout
  return {
    steps: base.steps,
    freeSteps: free.steps,
    freeSpinsPlayed: free.spinsPlayed,
    payout: Math.min(total, AZTEC_MAX_WIN_MULTIPLIER),
    capped: total >= AZTEC_MAX_WIN_MULTIPLIER,
  }
}
