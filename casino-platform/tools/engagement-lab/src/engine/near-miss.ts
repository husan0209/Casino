import {
  TIGER_ROW_INDEX,
  houseRowPayout,
  type TigerActiveLine,
  type TigerIcon,
  type TigerSpinRow,
} from '../../../../apps/api/src/modules/casino/domain/house-slot-game'
import { NEAR_MISS_CONFIG } from '../config'
import { winRatioOf } from './spin-math'
import { EngagementPhase } from '../domain/engagement-phase'
import {
  type EngagementState,
  type LabGame,
  type NearMissSelection,
  type RandomFn,
} from '../domain/types'

/**
 * §8.2: приоритеты паттернов. Это числа ТЗ (§8.2, код `NEAR_MISS_PATTERNS`),
 * но в `src/config.ts` их нет — поэтому константа живёт здесь и названа в
 * отчёте. Менять молча нельзя: от приоритета зависит, какой near-miss игрок
 * увидит при конфликтующих кандидатах.
 */
export const NEAR_MISS_PATTERN_PRIORITIES = {
  jackpot_one_off: 10,
  bonus_adjacent: 8,
  high_value_almost: 5,
} as const

export type NearMissPatternName = keyof typeof NEAR_MISS_PATTERN_PRIORITIES

/** Порядок обхода фиксированный: при равном seed результат не зависит от Set. */
const PATTERN_ORDER: readonly NearMissPatternName[] = [
  'jackpot_one_off',
  'bonus_adjacent',
  'high_value_almost',
]
/**
 * lab default: «рядом» = ячейка того же барабана на строку выше/ниже, как на
 * схеме §8.3 (стрелки ↑ под первыми двумя JACKPOT). Физика барабана: каскад
 * остановился бы на позицию раньше/позже — только такой сосед читается как
 * «почти выиграл». Соседи по строке (ячейка соседнего барабана) не считаем.
 */
const ADJACENT_ROW_OFFSETS: readonly number[] = [-1, 1]

/**
 * lab default: «дорогой» символ = верхний квартиль paytable. Метрика — выплата
 * на тех длинах линии, которые вообще достижимы в таблицах игры (см.
 * reachableCombines): у Fortune Tiger строки win_4/win_5 = 2500/1000 — наследие
 * донора, на сетке 3x3 они недостижимы, и ранжирование по ним поставило бы
 * Symbol_2 выше Symbol_0, что противоречит реальной иерархии выплат.
 */
const HIGH_VALUE_QUARTILE_DIVISOR = 4

/** Бонус-символ в доноре именуется только по имени/маркерам в paytable. */
const BONUS_NAME_PATTERN = /bonus|wild|scatter|free/i

/** Ячейки донора в строке нумеруются с 1 (см. active_icon в таблицах). */
const DONOR_CELL_BASE = 1

interface GridDims {
  readonly cells: number
  readonly reels: number
  readonly rows: number
}

interface CellCoord {
  readonly row: number
  readonly reel: number
}

/** paytable, разложенная по tiers из §8.2: jackpot / bonus / high-value. */
export interface SymbolTiers {
  readonly jackpot: readonly string[]
  readonly bonus: readonly string[]
  readonly highValue: readonly string[]
}

/** Кандидат near-miss: строка + сработавший паттерн + его приоритет. */
export interface NearMissCandidate {
  readonly row: TigerSpinRow
  readonly pattern: NearMissPatternName
  readonly priority: number
}

/** Результат замера §8.2 на боевых таблицах: сколько строк вообще подходит. */
export interface NearMissPatternMeasurement {
  readonly gameId: string
  readonly displayName: string
  readonly gridCells: number
  readonly reels: number
  readonly rows: number
  readonly paylineShapes: number
  readonly winRows: number
  readonly rowsInPayoutWindow: number
  readonly jackpotOneOffRows: number
  /** Строки в окне, где на полной линии лежит reels-1 Jackpot, но третий рядом не встал. */
  readonly jackpotNearLineRows: number
  readonly bonusAdjacentRows: number
  readonly highValueAlmostRows: number
  readonly rowsMatchingAnyPattern: number
  /** Строки, дожившие до выбора: окно выплаты + хотя бы один паттерн. */
  readonly selectableCandidates: number
  readonly highValueSymbols: readonly string[]
  readonly jackpotSymbols: readonly string[]
  readonly bonusSymbols: readonly string[]
}

/**
 * §8.2: пора ли near-miss (частота фазы §5.3 + dithering ±5 %).
 * В COOLDOWN и DORMANT — всегда false (§17: «Не применять LDW/Near-Miss в
 * фазе COOLDOWN», DORMANT в §5.3 вообще без манипуляций).
 * Случай берётся ТОЛЬКО из переданного random: Math.random здесь означал бы
 * невоспроизводимый прогон, что убивает весь смысл лаборатории.
 */
export function shouldApplyNearMiss(state: EngagementState, random: RandomFn): boolean {
  if (isManipulationBlockedPhase(state.engagementPhase)) {
    return false
  }

  const baseRate = NEAR_MISS_CONFIG.rateByPhase[state.engagementPhase]
  if (baseRate <= 0) {
    return false
  }

  const dither = (random() - 0.5) * 2 * NEAR_MISS_CONFIG.ditherRange
  const adjustedRate = Math.max(0, baseRate + dither)
  return random() < adjustedRate
}

/**
 * §8.2: выбрать строку под паттерн near-miss.
 *
 * Важно для честности замера: окно «платит мало» в §8.2 описано как
 * payout < 2, но payout в таблице донора — множитель ЛИНИИ, а не доля ставки.
 * На Fortune Tiger минимальный payout строки = 3, то есть в буквальном
 * чтении окно пусто и near-miss не сработал бы никогда. Окно считаем через
 * winRatioOf(row) < NEAR_MISS_CONFIG.maxPayoutMultiplier и фиксируем
 * расхождение в отчёте (README §8.2).
 *
 * Паттерны (§8.2): jackpot_one_off (10), bonus_adjacent (8), high_value_almost (5).
 * Геометрия сетки берётся из строки донора: [0] символы, [1] подсвеченные
 * ячейки; у Tiger 5 линий, у Queen of Bounty 15 ячеек 3x5 и каскады в [3].
 */
export function selectNearMissRow(
  game: LabGame,
  state: EngagementState,
  random: RandomFn,
): NearMissSelection | null {
  // §17, второй эшелон защиты: движок и так не зовёт нас в этих фазах, но строка
  // near-miss не должна утекать в COOLDOWN/DORMANT и при прямом вызове.
  if (isManipulationBlockedPhase(state.engagementPhase)) {
    return null
  }

  const candidates = nearMissCandidatesOf(game)
  if (candidates.length === 0) {
    return null
  }

  const bestPriority = candidates.reduce((max, candidate) => Math.max(max, candidate.priority), 0)
  const tied = candidates.filter((candidate) => candidate.priority === bestPriority)
  const chosen = tied[Math.floor(random() * tied.length)] ?? tied[0]
  if (!chosen) {
    return null
  }
  return { row: chosen.row, pattern: chosen.pattern }
}

/**
 * Все near-miss кандидаты игры: окно выплаты + геометрия паттернов.
 * Отдельная функция, потому что замер §8.2 («сколько строк вообще подходит»)
 * обязан считать то же множество, из которого потом выбирает selectNearMissRow,
 * а не свою отдельную версию правил.
 */
export function nearMissCandidatesOf(game: LabGame): NearMissCandidate[] {
  const analysis = analyzeGame(game)
  if (!analysis) {
    return []
  }
  const candidates: NearMissCandidate[] = []
  for (const row of rowsInPayoutWindow(game)) {
    for (const pattern of matchingPatterns(row, analysis)) {
      candidates.push({ row, pattern, priority: NEAR_MISS_PATTERN_PRIORITIES[pattern] })
    }
  }
  return candidates
}

/** Замер по игре: сколько win-строк подходит под окно выплаты и под каждый паттерн. */
export function measureNearMissPatterns(game: LabGame): NearMissPatternMeasurement {
  const analysis = analyzeGame(game)
  const tiers = analysis?.tiers ?? { jackpot: [], bonus: [], highValue: [] }
  const matched = analysis
    ? rowsInPayoutWindow(game).map((row) => matchingPatterns(row, analysis))
    : []
  const rowsWith = (pattern: NearMissPatternName): number =>
    matched.filter((patterns) => patterns.includes(pattern)).length

  const jackpotNearLines = analysis
    ? rowsInPayoutWindow(game).filter(
        (row) => jackpotGaps(row[TIGER_ROW_INDEX.slotIcons], analysis).length > 0,
      ).length
    : 0

  return {
    gameId: game.externalGameId,
    displayName: game.displayName,
    gridCells: analysis?.dims.cells ?? 0,
    reels: analysis?.dims.reels ?? 0,
    rows: analysis?.dims.rows ?? 0,
    paylineShapes: analysis?.shapes.length ?? 0,
    winRows: game.winRows.length,
    rowsInPayoutWindow: matched.length,
    jackpotOneOffRows: rowsWith('jackpot_one_off'),
    jackpotNearLineRows: jackpotNearLines,
    bonusAdjacentRows: rowsWith('bonus_adjacent'),
    highValueAlmostRows: rowsWith('high_value_almost'),
    rowsMatchingAnyPattern: matched.filter((patterns) => patterns.length > 0).length,
    selectableCandidates: matched.reduce((sum, patterns) => sum + patterns.length, 0),
    highValueSymbols: tiers.highValue,
    jackpotSymbols: tiers.jackpot,
    bonusSymbols: tiers.bonus,
  }
}

/**
 * Win-строки в окне «платит мало» (§8.2 + §17). Единая функция для выбора и
 * для замера: иначе цифры теста могли бы описывать не то множество, из которого
 * реально берётся строка.
 */
function rowsInPayoutWindow(game: LabGame): TigerSpinRow[] {
  return game.winRows.filter((row) => {
    const payout = houseRowPayout(row, game.payoutModel)
    return payout > 0 && winRatioOf(payout, game.paylines) < NEAR_MISS_CONFIG.maxPayoutMultiplier
  })
}

/** В COOLDOWN и DORMANT механики запрещены (§17, §5.3:Near-Miss Rate 0 %). */
function isManipulationBlockedPhase(phase: EngagementPhase): boolean {
  return phase === EngagementPhase.COOLDOWN || phase === EngagementPhase.DORMANT
}

interface GameAnalysis {
  readonly dims: GridDims
  readonly tiers: SymbolTiers
  /** Полные геометрии линий, собранные из самих таблиц донора. */
  readonly shapes: readonly (readonly CellCoord[])[]
}

function analyzeGame(game: LabGame): GameAnalysis | null {
  const dims = gridDimsOf(game)
  if (!dims) {
    return null
  }
  return { dims, tiers: classifySymbols(game), shapes: paylineShapesOf(game, dims) }
}

/**
 * Размеры сетки из данных донора, а не из догадки: число ячеек = длина [0],
 * число барабанов = длина самой длинной линии в таблицах (у Tiger 3, у
 * Queen of Bounty 5), строк = ячейки / барабаны. Нумерация row-major:
 * flat = row * reels + reel — это единственная раскладка, при которой линии
 * вида [1,2,3] и [1,7,13] проходят по одному символу с каждого барабана.
 */
function gridDimsOf(game: LabGame): GridDims | null {
  const firstRow = game.winRows[0] ?? game.loseRows[0]
  if (!firstRow) {
    return null
  }
  const cells = firstRow[TIGER_ROW_INDEX.slotIcons].length
  if (cells === 0) {
    return null
  }
  const reels = longestLineOf(game)
  if (reels === 0 || cells % reels !== 0) {
    return null
  }
  return { cells, reels, rows: cells / reels }
}

function longestLineOf(game: LabGame): number {
  let longest = 0
  for (const row of [...game.winRows, ...game.loseRows]) {
    for (const line of row[TIGER_ROW_INDEX.activeLines]) {
      longest = Math.max(longest, line.active_icon.length)
    }
  }
  return longest
}

function cellToCoord(cell: number, dims: GridDims): CellCoord | null {
  const flat = cell - DONOR_CELL_BASE
  if (!Number.isInteger(flat) || flat < 0 || flat >= dims.cells) {
    return null
  }
  return { row: Math.floor(flat / dims.reels), reel: flat % dims.reels }
}

function coordsOfLine(line: TigerActiveLine, dims: GridDims): CellCoord[] {
  const coords: CellCoord[] = []
  for (const cell of line.active_icon) {
    const coord = cellToCoord(cell, dims)
    if (coord) {
      coords.push(coord)
    }
  }
  return coords
}

/** Линия покрывает каждый барабан ровно одной ячейкой — форма полной линии. */
function coordsCoverAllReels(coords: readonly CellCoord[], reels: number): boolean {
  const byReel = new Map<number, CellCoord>()
  for (const coord of coords) {
    if (byReel.has(coord.reel)) {
      return false
    }
    byReel.set(coord.reel, coord)
  }
  return byReel.size === reels
}

function flatOf(coord: CellCoord, dims: GridDims): number {
  return coord.row * dims.reels + coord.reel
}

function sameCell(first: CellCoord, second: CellCoord): boolean {
  return first.row === second.row && first.reel === second.reel
}

/**
 * Библиотека полных линий: геометрии, которые реально встречаются в таблицах
 * (по одной ячейке на каждый барабан). Хардкодить «классические» линии нельзя:
 * тогда near-miss проверялся бы на схеме, которой нет у донора.
 */
function paylineShapesOf(game: LabGame, dims: GridDims): readonly (readonly CellCoord[])[] {
  const byKey = new Map<string, readonly CellCoord[]>()
  for (const row of game.winRows) {
    for (const line of row[TIGER_ROW_INDEX.activeLines]) {
      const coords = coordsOfLine(line, dims)
      if (coords.length !== dims.reels) {
        continue
      }
      if (!coordsCoverAllReels(coords, dims.reels)) {
        continue
      }
      const ordered = coords
        .slice()
        .sort((left, right) => left.reel - right.reel || left.row - right.row)
      const key = ordered.map((coord) => `${coord.reel}:${coord.row}`).join('|')
      if (!byKey.has(key)) {
        byKey.set(key, ordered)
      }
    }
  }
  return [...byKey.values()]
}

/** Выплаты символа на тех длинах линии, которые достижимы в таблицах игры. */
function reachableCombinesOf(game: LabGame): number[] {
  const combines = new Set<number>()
  for (const row of [...game.winRows, ...game.loseRows]) {
    for (const line of row[TIGER_ROW_INDEX.activeLines]) {
      if (line.combine > 0) {
        combines.add(line.combine)
      }
    }
  }
  return [...combines].sort((left, right) => left - right)
}

function iconPayout(icon: TigerIcon, combines: readonly number[]): number {
  const wins = [icon.win_1, icon.win_2, icon.win_3, icon.win_4, icon.win_5, icon.win_6]
  const reachable = combines
    .filter((combine) => combine >= 1 && combine <= wins.length)
    .map((combine) => wins[combine - 1] ?? 0)
  const pool = reachable.length > 0 ? reachable : wins
  return pool.reduce((max, value) => Math.max(max, value), 0)
}

function hasBonusMarker(icon: TigerIcon): boolean {
  const markers = [icon.wild_card, icon.free_spin, icon.scaler_spin, icon.free_num]
  const flagged = markers.some(
    (marker) => marker !== null && marker !== undefined && marker !== 0 && marker !== false,
  )
  return flagged || BONUS_NAME_PATTERN.test(icon.icon_name)
}

/**
 * §8.2: classification «дорогой / jackpot / bonus» по paytable.
 *
 * - high-value: верхний квартиль по выплате (HIGH_VALUE_QUARTILE_DIVISOR);
 * - jackpot: символы с максимальной выплатой в таблице (высший тир игры);
 * - bonus: отдельный bonus/wild/scatter символ. В реальных таблицах донора
 *   маркеров нет вовсе (wild_card/free_spin/scaler_spin = null, free_num = 0),
 *   а имена — безликие Symbol_N, поэтому для боевых игр tier пуст и
 *   bonus_adjacent честно не даёт кандидатов. Это результат замера, а не баг.
 */
export function classifySymbols(game: LabGame): SymbolTiers {
  const combines = reachableCombinesOf(game)
  const ranked = game.paytable.data
    .map((icon) => ({ name: icon.icon_name, value: iconPayout(icon, combines) }))
    .filter((entry) => entry.value > 0)
    .sort((left, right) => right.value - left.value || left.name.localeCompare(right.name))

  const topQuartile = Math.max(1, Math.ceil(ranked.length / HIGH_VALUE_QUARTILE_DIVISOR))
  const highestValue = ranked[0]?.value ?? 0

  return {
    highValue: ranked.slice(0, topQuartile).map((entry) => entry.name),
    jackpot: ranked.filter((entry) => entry.value === highestValue).map((entry) => entry.name),
    bonus: game.paytable.data.filter(hasBonusMarker).map((icon) => icon.icon_name),
  }
}

/** Паттерны, которые удовлетворяет конкретная строка (в порядке приоритета). */
function matchingPatterns(row: TigerSpinRow, analysis: GameAnalysis): NearMissPatternName[] {
  const grid = row[TIGER_ROW_INDEX.slotIcons]
  if (grid.length !== analysis.dims.cells) {
    return []
  }
  const satisfied: Record<NearMissPatternName, boolean> = {
    jackpot_one_off: matchesJackpotOneOff(grid, analysis),
    bonus_adjacent: matchesBonusAdjacent(grid, row, analysis),
    high_value_almost: matchesHighValueAlmost(grid, row, analysis),
  }
  return PATTERN_ORDER.filter((pattern) => satisfied[pattern])
}

/**
 * jackpot_one_off (§8.2, схема §8.3): на полной линии стоят reels-1 Jackpot,
 * а недостающий Jackpot — на строку выше/ниже от своей позиции. То есть
 * «две из трёх на линии + третья рядом»; строка при этом НЕ платит по этой
 * линии, поэтому и остаётся в окне малых выплат.
 */
function matchesJackpotOneOff(grid: readonly string[], analysis: GameAnalysis): boolean {
  const { dims } = analysis
  return jackpotGaps(grid, analysis).some(({ symbol, gap }) =>
    ADJACENT_ROW_OFFSETS.some((offset) => {
      const neighborRow = gap.row + offset
      if (neighborRow < 0 || neighborRow >= dims.rows) {
        return false
      }
      // Форма линии содержит ровно одну ячейку на каждый барабан, поэтому
      // сосед того же барабана априори вне линии — отдельная проверка не нужна.
      return grid[flatOf({ row: neighborRow, reel: gap.reel }, dims)] === symbol
    }),
  )
}

interface JackpotGap {
  readonly symbol: string
  readonly gap: CellCoord
}

/**
 * Линии, где Jackpot-символа не хватает ровно на одну ячейку. Для замера N:
 * если таких линий нет вовсе, то и jackpot_one_off удовлетворим быть не может,
 * и дело не в соседстве, а в том, что донор не перечисляет такие сетки.
 */
function jackpotGaps(grid: readonly string[], analysis: GameAnalysis): JackpotGap[] {
  const { dims, shapes, tiers } = analysis
  if (dims.reels < 2 || tiers.jackpot.length === 0) {
    return []
  }
  const gaps: JackpotGap[] = []
  for (const shape of shapes) {
    for (const symbol of tiers.jackpot) {
      const gap = jackpotGapOnShape({ grid, shape, symbol, dims })
      if (gap) {
        gaps.push(gap)
      }
    }
  }
  return gaps
}

/** Линия, где символа не хватает ровно на одну ячейку; null — линия не подходит. */
function jackpotGapOnShape(args: {
  grid: readonly string[]
  shape: readonly CellCoord[]
  symbol: string
  dims: GridDims
}): JackpotGap | null {
  const { grid, shape, symbol, dims } = args
  const missing: CellCoord[] = []
  let onLine = 0
  for (const coord of shape) {
    if (grid[flatOf(coord, dims)] === symbol) {
      onLine += 1
    } else {
      missing.push(coord)
    }
  }
  const gap = missing[0]
  if (onLine === dims.reels - 1 && missing.length === 1 && gap) {
    return { symbol, gap }
  }
  return null
}

/**
 * bonus_adjacent (§8.2): Bonus-символ стоит рядом с выигрышной линией строки,
 * но не на ней. Пустой tier (реальные таблицы донора) => кандидатов нет.
 */
function matchesBonusAdjacent(
  grid: readonly string[],
  row: TigerSpinRow,
  analysis: GameAnalysis,
): boolean {
  return hasNeighborSymbol({
    grid,
    row,
    analysis,
    predicate: (symbol) => analysis.tiers.bonus.includes(symbol),
  })
}

/**
 * high_value_almost (§8.2): дорогой символ на соседней позиции от выигрышной
 * линии. Символ линии не считаем: он уже оплачен, «почти» здесь не возникает.
 */
function matchesHighValueAlmost(
  grid: readonly string[],
  row: TigerSpinRow,
  analysis: GameAnalysis,
): boolean {
  const lineSymbols = row[TIGER_ROW_INDEX.activeLines].map((line) => line.name)
  return hasNeighborSymbol({
    grid,
    row,
    analysis,
    predicate: (symbol) =>
      analysis.tiers.highValue.includes(symbol) && !lineSymbols.includes(symbol),
  })
}

/** Есть ли ячейка вне линий строки, соседняя по барабану и подходящая под предикат. */
function hasNeighborSymbol(args: {
  grid: readonly string[]
  row: TigerSpinRow
  analysis: GameAnalysis
  predicate: (symbol: string) => boolean
}): boolean {
  const { grid, row, analysis, predicate } = args
  const { dims } = analysis
  const lineCoords: CellCoord[] = []
  for (const line of row[TIGER_ROW_INDEX.activeLines]) {
    lineCoords.push(...coordsOfLine(line, dims))
  }
  if (lineCoords.length === 0) {
    return false
  }

  for (const coord of lineCoords) {
    for (const offset of ADJACENT_ROW_OFFSETS) {
      const neighborRow = coord.row + offset
      if (neighborRow < 0 || neighborRow >= dims.rows) {
        continue
      }
      const neighbor = { row: neighborRow, reel: coord.reel }
      if (lineCoords.some((lineCoord) => sameCell(lineCoord, neighbor))) {
        continue
      }
      if (predicate(grid[flatOf(neighbor, dims)] ?? '')) {
        return true
      }
    }
  }
  return false
}
