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
 * Параметры откалиброваны прогоном Монте-Карло (aztec-game.spec.ts). Замер на
 * 8 000 000 спинов (4 сида): RTP 95,90 % (95 % ДИ ±0,20), доля выигрышных
 * спинов 22,96 %, фриспины 1 из 293, максимальное наблюдение 182,8× при
 * потолке ×1000 (потолок за всю выборку не сработал ни разу).
 */

export type AztecPaySymbol = 'J' | 'Q' | 'K' | 'A' | 'F' | 'B' | 'G' | 'M'
export type AztecSymbol = AztecPaySymbol | 'W' | 'T'

/**
 * Витринный RTP игры: то же число, что видит игрок на плитке каталога.
 * Занижено относительно круглых 96 намеренно — таблица платит 95,9 %, а
 * завышать отдачу перед игроком нельзя.
 */
export const AZTEC_TARGET_RTP = 95.9

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
/** Множитель первого каскада фриспина: клиент показывает его в правилах. */
export const AZTEC_FREE_MULTIPLIER_START = 3
export const AZTEC_MAX_WIN_MULTIPLIER = 1000
/** Дикий может прилететь в досыпку на крайнем барабане. */
export const AZTEC_REFILL_WILD_CHANCE = 0.35

/** Шаг округления выплаты при масштабе: 0,01 — тот же принцип, что у комплекта Plinko. */
const PAYTABLE_STEP = 100

/**
 * Настройка выплат: таблица и плата скаттеров. Движок играет ПО ТАБЛИЦЕ,
 * которую отдаёт /state, поэтому «на доске одно, платит другое» невозможно
 * даже когда админ поднимает RTP: масштабуется именно таблица, а не деньги.
 */
export interface AztecTuning {
  paytable: Record<AztecPaySymbol, readonly number[]>
  scatterPay: readonly number[]
}

export const AZTEC_BASE_TUNING: AztecTuning = {
  paytable: AZTEC_PAYTABLE,
  scatterPay: AZTEC_SCATTER_PAY,
}

function scaleRow(values: readonly number[], factor: number): number[] {
  return values.map((value) => Math.round(value * factor * PAYTABLE_STEP) / PAYTABLE_STEP)
}

/**
 * Таблица под целевой возврат. Отдача движка линейна по платёжной таблице
 * (проверено прогоном: scale=1 → 7,74 %, scale=12,4 → 90,5 %), поэтому цель
 * админа превращается в один множитель базовой калибровки.
 */
export function aztecTuningForTarget(targetRtpPercent: number): AztecTuning {
  if (!Number.isFinite(targetRtpPercent) || targetRtpPercent === AZTEC_TARGET_RTP) {
    return AZTEC_BASE_TUNING
  }
  const factor = Math.max(0, targetRtpPercent) / AZTEC_TARGET_RTP
  const paytable = {} as Record<AztecPaySymbol, readonly number[]>
  for (const symbol of AZTEC_PAY_SYMBOLS) {
    paytable[symbol] = scaleRow(AZTEC_PAYTABLE[symbol], factor)
  }
  return { paytable, scatterPay: scaleRow(AZTEC_SCATTER_PAY, factor) }
}

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
  /** Подсвеченные клетки как [барабан, позиция]: клиент рисует ровно то, что посчитал движок. */
  cells: [number, number][]
  /** Вклад скаттеров в этот шаг до множителя: платят они только на первом шаге захода. */
  scatter: number
}

/**
 * Один заход: долетевшая доска и её каскады. `spin` — 0 у базы, 1..N у
 * фриспинов. Проигравший заход остаётся видимым: без него клиент не может
 * показать фриспин, сыгранное «в никуда», и счётчик заходов расходится с
 * анимацией.
 */
export type AztecPlay = {
  spin: number
  grid: AztecSymbol[][]
  steps: AztecChainStep[]
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
  /** Заходы по порядку: база (spin 0) и фриспины (1..N). У проигравшего захода steps пуст, но доска есть. */
  plays: AztecPlay[]
  freeSpinsPlayed: number
  payout: number
  capped: boolean
}

/** Плоский список шагов всех заходов — тот же порядок, по которому считается хеш исхода. */
export function flattenAztecPlays(plays: readonly AztecPlay[]): AztecChainStep[] {
  return plays.reduce<AztecChainStep[]>((acc, play) => [...acc, ...play.steps], [])
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

/** Политика фриспинов: номер захода кладётся в AztecPlay, а не в шаг. */
const FREE_MULTIPLIER: MultiplierPolicy = {
  start: AZTEC_FREE_MULTIPLIER_START,
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

function tierPayout(
  symbol: AztecPaySymbol,
  match: number,
  paytable: Record<AztecPaySymbol, readonly number[]>,
): number {
  const table = paytable[symbol]
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

function scatterPayout(scatters: number, scatterPay: readonly number[]): number {
  if (scatters < AZTEC_SCATTER_MIN) {
    return 0
  }
  return scatterPay[Math.min(scatters, 6) - AZTEC_SCATTER_MIN] ?? 0
}

/**
 * Оценка доски. Платит ОДНА лучшая символьная группа: при восьми символах на
 * 34 ячейках «хотя бы одна связка из трёх барабанов» почти достоверна, и выплата
 * по всем группам сразу дала бы выигрыш на 99% спинов.
 */
export function evaluateAztecGrid(
  grid: AztecSymbol[][],
  tuning: AztecTuning = AZTEC_BASE_TUNING,
): AztecEvaluation {
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
    const payout = reels >= AZTEC_MIN_REELS ? tierPayout(symbol, match, tuning.paytable) : 0
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

/** Координаты подсвеченных клеток: движок уже знает их, клиенту остаётся нарисовать. */
function winCells(removed: boolean[][]): [number, number][] {
  const cells: [number, number][] = []
  removed.forEach((reelMarks, reel) => {
    reelMarks.forEach((marked, position) => {
      if (marked) {
        cells.push([reel, position])
      }
    })
  })
  return cells
}

/**
 * Цепочка каскадов одной игры — базовой или одного фриспина.
 *
 * Выплата скаттеров только на первом шаге: на каждом каскаде она превращается в
 * надбавку, не зависящую от платёжной таблицы, и хвост распределения переставал
 * калиброваться (это и ловилось на прототипе).
 */
/** Всё, чем одна цепочка отличается от другой: политика множителя и таблица выплат. */
interface AztecChainContext {
  policy: MultiplierPolicy
  tuning: AztecTuning
}

function runChain(
  grid: AztecSymbol[][],
  rng: () => number,
  context: AztecChainContext,
): AztecChainResult {
  const { policy, tuning } = context
  const steps: AztecChainStep[] = []
  let payout = 0
  let multiplier = policy.start
  let current = grid

  for (let cascade = 0; cascade < AZTEC_MAX_CASCADES; cascade += 1) {
    const evaluated = evaluateAztecGrid(current, tuning)
    const scatter = cascade === 0 ? scatterPayout(countScatters(current), tuning.scatterPay) : 0
    const win = evaluated.payout + scatter
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
      cells: winCells(evaluated.removed),
      scatter,
    })
    if (payout >= AZTEC_MAX_WIN_MULTIPLIER) {
      return { steps, payout: AZTEC_MAX_WIN_MULTIPLIER, capped: true }
    }
    current = collapseGrid(current, evaluated.removed, rng)
    multiplier = Math.min(multiplier + policy.step, policy.cap)
  }

  return { steps, payout, capped: false }
}

function playFreeSpins(
  rng: () => number,
  tuning: AztecTuning,
): {
  plays: AztecPlay[]
  payout: number
  capped: boolean
  spinsPlayed: number
} {
  const plays: AztecPlay[] = []
  let payout = 0
  let capped = false
  let budget = AZTEC_FREE_SPINS
  let spinsPlayed = 0

  while (budget > 0 && spinsPlayed < AZTEC_FREE_SPINS_HARD_LIMIT) {
    const grid = buildAztecGrid(rng)
    const chain = runChain(grid, rng, { policy: FREE_MULTIPLIER, tuning })
    spinsPlayed += 1
    plays.push({ spin: spinsPlayed, grid, steps: chain.steps })
    payout += chain.payout
    budget -= 1
    if (countScatters(grid) >= AZTEC_FREE_RETRIGGER_MIN) {
      budget += AZTEC_FREE_RETRIGGER
    }
    if (chain.capped) {
      capped = true
      break
    }
  }

  return { plays, payout, capped, spinsPlayed }
}

/**
 * Один спин целиком: база с каскадами и фриспины, если они триггернулись.
 * Каждый заход — отдельный элемент `plays`, включая пустой: игрок обязан
 * видеть все сыгранные фриспины, а не только те, что дали связку.
 */
export function playAztecSpin(
  rng: () => number,
  tuning: AztecTuning = AZTEC_BASE_TUNING,
): AztecSpin {
  const grid = buildAztecGrid(rng)
  const triggered = countScatters(grid) >= AZTEC_SCATTER_MIN
  const base = runChain(grid, rng, { policy: BASE_MULTIPLIER, tuning })
  const plays: AztecPlay[] = [{ spin: 0, grid, steps: base.steps }]
  const free = triggered ? playFreeSpins(rng, tuning) : null

  const total = base.payout + (free ? free.payout : 0)
  if (free) {
    plays.push(...free.plays)
  }

  return {
    plays,
    freeSpinsPlayed: free ? free.spinsPlayed : 0,
    payout: Math.min(total, AZTEC_MAX_WIN_MULTIPLIER),
    capped: total >= AZTEC_MAX_WIN_MULTIPLIER,
  }
}
