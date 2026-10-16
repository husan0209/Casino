/**
 * ТЗ ч.9 §8.1 — LDW (Loss Disguised as Win): выплата 30–60 % ставки,
 * которую фронт показывает как полноценную победу.
 *
 * Важно: фронту НЕ сообщается, что исход подставлен (§8.1 «не показывать,
 * что это частичный возврат»), поэтому здесь нет ни флагов ответа, ни
 * отдельного кода исхода — LDW-строка неотличима от обычной выигрышной.
 * Для аналитики факт применения пишется в engagement_events (§11.3).
 */
import { Decimal } from 'decimal.js'

import type { MoneyAmount } from '@casino/shared-types'

import { LDW_FREQUENCY, type EngagementConfig } from './engagement-config'
import { mechanicsAllowedIn } from './engagement-phase'
import { houseRowPayout, type HouseSlotPayoutModel, type TigerSpinRow } from '../house-slot-game'

import type { EngagementPhase } from './engagement-phase'

/** Генератор случайных чисел в [0,1) — инъецируется, в проде cryptoRandom. */
export type RandomSource = () => number

export interface LdwDecision {
  readonly apply: boolean
  /** Интервал между LDW, на который сработал dithering (§8.1). */
  readonly targetInterval: number
  readonly reason:
    | 'applied'
    | 'disabled_by_flag'
    | 'terminal_phase'
    | 'dither_interval_not_reached'
    | 'no_candidate_row'
}

/**
 * §8.1 — частота LDW по фазе с dithering ±ditherRange.
 * Частота переводится в интервал спинов; спин применяет LDW, когда с последнего
 * LDW прошло не меньше интервала минус один.
 */
export function shouldApplyLdw(args: {
  phase: EngagementPhase
  spinsSinceLastLdw: number
  config: EngagementConfig
  random: RandomSource
}): { apply: boolean; targetInterval: number; reason: LdwDecision['reason'] } {
  const { phase, spinsSinceLastLdw, config, random } = args

  if (!config.ldwEnabled) {
    return { apply: false, targetInterval: 0, reason: 'disabled_by_flag' }
  }
  // §17: в COOLDOWN/DORMANT манипуляции не применяются.
  if (!mechanicsAllowedIn(phase)) {
    return { apply: false, targetInterval: 0, reason: 'terminal_phase' }
  }

  const baseFrequency = LDW_FREQUENCY[phase]
  if (baseFrequency <= 0) {
    return { apply: false, targetInterval: 0, reason: 'terminal_phase' }
  }

  // Dithering: ±ditherRange к частоте, чтобы игрок не видел регулярного паттерна.
  const dither = (random() - 0.5) * 2 * config.ditherRange
  const adjustedFrequency = Math.max(baseFrequency + dither, 0.01)
  const targetInterval = Math.max(1, Math.round(1 / adjustedFrequency))

  if (spinsSinceLastLdw < targetInterval - 1) {
    return { apply: false, targetInterval, reason: 'dither_interval_not_reached' }
  }
  return { apply: true, targetInterval, reason: 'applied' }
}

/**
 * §8.1 — выбор строки выплаты в окне 30–60 % ставки.
 *
 * Множители строк у донора — в единицах ставки, поэтому кандидат отбирается
 * по `payout >= minRatio && payout <= maxRatio`, а не по деньгам: окно задано
 * в долях ставки и не зависит от её размера.
 */
export function selectLdwRow(args: {
  winRows: readonly TigerSpinRow[]
  payoutModel: HouseSlotPayoutModel
  config: EngagementConfig
  random: RandomSource
}): { row: TigerSpinRow | null; reason: LdwDecision['reason'] } {
  const { winRows, payoutModel, config, random } = args

  const min = new Decimal(config.ldwMinPayoutRatio)
  const max = new Decimal(config.ldwMaxPayoutRatio)

  const candidates = winRows.filter((row) => {
    const payout = houseRowPayout(row, payoutModel)
    if (!Number.isFinite(payout) || payout <= 0) {
      return false
    }
    const ratio = new Decimal(payout)
    return ratio.gte(min) && ratio.lte(max)
  })

  if (candidates.length === 0) {
    return { row: null, reason: 'no_candidate_row' }
  }
  const index = Math.min(candidates.length - 1, Math.floor(random() * candidates.length))
  return { row: candidates[index] ?? null, reason: 'applied' }
}

/** Диагностика для логов: сколько строк таблицы вообще попадает в окно LDW. */
export function ldwCandidateRatio(args: {
  winRows: readonly TigerSpinRow[]
  payoutModel: HouseSlotPayoutModel
  config: EngagementConfig
}): number {
  if (args.winRows.length === 0) {
    return 0
  }
  const min = new Decimal(args.config.ldwMinPayoutRatio)
  const max = new Decimal(args.config.ldwMaxPayoutRatio)
  const count = args.winRows.filter((row) => {
    const payout = houseRowPayout(row, args.payoutModel)
    if (!Number.isFinite(payout) || payout <= 0) {
      return false
    }
    const ratio = new Decimal(payout)
    return ratio.gte(min) && ratio.lte(max)
  }).length
  return count / args.winRows.length
}

/** Проверка, что строка действительно лежит в окне — используется в тестах. */
export function isLdwRow(args: {
  row: TigerSpinRow
  payoutModel: HouseSlotPayoutModel
  config: EngagementConfig
}): boolean {
  const payout = houseRowPayout(args.row, args.payoutModel)
  if (!Number.isFinite(payout) || payout <= 0) {
    return false
  }
  const ratio = new Decimal(payout)
  return ratio.gte(args.config.ldwMinPayoutRatio) && ratio.lte(args.config.ldwMaxPayoutRatio)
}

/** Сумма выплаты строки в деньгах — для §11.2 и проверок в тестах. */
export function ldwPayoutAmount(
  row: TigerSpinRow,
  payoutModel: HouseSlotPayoutModel,
  bet: MoneyAmount,
): MoneyAmount {
  return new Decimal(bet).times(houseRowPayout(row, payoutModel)).toFixed(8)
}
