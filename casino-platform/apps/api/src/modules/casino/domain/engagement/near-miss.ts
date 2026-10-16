/**
 * ТЗ ч.9 §8.2 — Near-Miss: исход, в котором дорогие символы «почти» собрались.
 *
 * В ТЗ условия паттернов оставлены плейсхолдерами (`return true`), поэтому
 * здесь они доведены до проверяемой формы по данным строки донора: у строки
 * есть поле `combine` — сколько позиций совпало на линии. Near-Miss — это
 * линия с двумя совпадениями из трёх, но с небольшой суммарной выплатой,
 * чтобы это не превратилось в настоящий крупный выигрыш.
 */
import { Decimal } from 'decimal.js'

import { NEAR_MISS_FREQUENCY, type EngagementConfig } from './engagement-config'
import { mechanicsAllowedIn } from './engagement-phase'
import {
  houseRowPayout,
  TIGER_ROW_INDEX,
  type HouseSlotPayoutModel,
  type TigerActiveLine,
  type TigerSpinRow,
} from '../house-slot-game'

import type { EngagementPhase } from './engagement-phase'
import type { RandomSource } from './ldw'

export interface NearMissPattern {
  readonly name: string
  readonly description: string
  readonly priority: number
  /** Верхняя граница выплаты паттерна в множителях ставки. */
  readonly maxPayoutMultiplier: number
  readonly matches: (row: TigerSpinRow) => boolean
}

/** Линии строки с ровно двумя совпадениями из трёх — «два джекпота, третий мимо». */
function hasTwoOfThreeLine(row: TigerSpinRow): boolean {
  const lines = row[TIGER_ROW_INDEX.activeLines] as TigerActiveLine[]
  return lines.some((line) => line.combine === 2 || line.active_icon.length === 2)
}

/** Больше двух совпадений — это уже выигрыш, а не «почти». */
function hasLongerLine(row: TigerSpinRow): boolean {
  const lines = row[TIGER_ROW_INDEX.activeLines] as TigerActiveLine[]
  return lines.some((line) => line.combine >= 3)
}

export const NEAR_MISS_PATTERNS: readonly NearMissPattern[] = [
  {
    name: 'jackpot_one_off',
    description: 'Два совпадения из трёх, выплата меньше половины ставки',
    priority: 10,
    maxPayoutMultiplier: 0.5,
    matches: (row) => {
      if (hasLongerLine(row)) {
        return false
      }
      return houseRowPayout(row, 'lines') >= 0 && hasTwoOfThreeLine(row)
    },
  },
  {
    name: 'bonus_adjacent',
    description: 'Два совпадения из трёх, небольшая выплата',
    priority: 8,
    maxPayoutMultiplier: 1.5,
    matches: (row) => !hasLongerLine(row) && hasTwoOfThreeLine(row),
  },
  {
    name: 'high_value_almost',
    description: 'Два совпадения из трёх, выплата до двух ставок',
    priority: 5,
    maxPayoutMultiplier: 2,
    matches: (row) => !hasLongerLine(row) && hasTwoOfThreeLine(row),
  },
]

export interface NearMissDecision {
  readonly row: TigerSpinRow | null
  readonly pattern: NearMissPattern | null
  readonly reason:
    'applied' | 'disabled_by_flag' | 'terminal_phase' | 'rate_not_reached' | 'no_candidate_row'
  /** Скорректированная dithering'ом частота — для §11.2. */
  readonly adjustedRate: number
}

/**
 * §8.2 — решает, применять ли Near-Miss, и выбирает строку.
 * Частота проверяется один раз на спин; выбор строки идёт по приоритету паттернов.
 */
export function selectNearMissRow(args: {
  winRows: readonly TigerSpinRow[]
  payoutModel: HouseSlotPayoutModel
  phase: EngagementPhase
  config: EngagementConfig
  random: RandomSource
}): NearMissDecision {
  const { winRows, payoutModel, phase, config, random } = args

  const gate = nearMissGate(phase, config, random)
  if (gate.reason) {
    return { row: null, pattern: null, reason: gate.reason, adjustedRate: gate.adjustedRate }
  }

  const adjustedRate = gate.adjustedRate
  if (random() > adjustedRate) {
    return { row: null, pattern: null, reason: 'rate_not_reached', adjustedRate }
  }

  const best = bestCandidate(winRows, payoutModel)
  if (!best) {
    return { row: null, pattern: null, reason: 'no_candidate_row', adjustedRate }
  }

  return { row: best.row, pattern: best.pattern, reason: 'applied', adjustedRate }
}

/** Выключатели и частота фазы с dithering; reason !== null → ничего не делаем. */
function nearMissGate(
  phase: EngagementPhase,
  config: EngagementConfig,
  random: RandomSource,
): { reason: NearMissDecision['reason'] | null; adjustedRate: number } {
  if (!config.nearMissEnabled) {
    return { reason: 'disabled_by_flag', adjustedRate: 0 }
  }
  // §17: в COOLDOWN/DORMANT механики не применяются.
  if (!mechanicsAllowedIn(phase)) {
    return { reason: 'terminal_phase', adjustedRate: 0 }
  }
  // Dithering ±ditherRange, чтобы игрок не видел регулярного паттерна (§8.2).
  const dither = (random() - 0.5) * 2 * config.ditherRange
  const adjustedRate = Math.max(0, NEAR_MISS_FREQUENCY[phase] + dither)
  return { reason: null, adjustedRate }
}

/** Лучший кандидат по приоритету паттернов (§8.2). */
function bestCandidate(
  winRows: readonly TigerSpinRow[],
  payoutModel: HouseSlotPayoutModel,
): { row: TigerSpinRow; pattern: NearMissPattern } | null {
  const candidates: Array<{ row: TigerSpinRow; pattern: NearMissPattern }> = []
  for (const pattern of NEAR_MISS_PATTERNS) {
    const cap = new Decimal(pattern.maxPayoutMultiplier)
    for (const row of winRows) {
      if (matchesPattern({ row, pattern, cap, payoutModel })) {
        candidates.push({ row, pattern })
      }
    }
  }
  if (candidates.length === 0) {
    return null
  }
  // «Более драматичный» паттерн приоритетнее (§8.2).
  candidates.sort((a, b) => b.pattern.priority - a.pattern.priority)
  return candidates[0] ?? null
}

function matchesPattern(args: {
  row: TigerSpinRow
  pattern: NearMissPattern
  cap: Decimal
  payoutModel: HouseSlotPayoutModel
}): boolean {
  const { row, pattern, cap, payoutModel } = args
  const payout = houseRowPayout(row, payoutModel)
  if (!Number.isFinite(payout) || payout <= 0) {
    return false
  }
  if (new Decimal(payout).gte(cap)) {
    return false
  }
  return pattern.matches(row)
}
