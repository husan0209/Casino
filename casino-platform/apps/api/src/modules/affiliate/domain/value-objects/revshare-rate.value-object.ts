/**
 * Ставка RevShare (ТЗ ч.8 §4 D6, §6.1).
 *
 * Ставка — это ДЕНЬГИ-ЗАВИСИМЫЙ параметр, поэтому хранится и считается как
 * Decimal-строка, а не number (AI_DEVELOPMENT_RULES §1). Диапазон [0, 1]:
 * 0.20 = 20% от NGR. Колонка БД — DECIMAL(5,4), т.е. шаг 0.0001.
 *
 * Value object, а не просто string: гарантирует, что ни один use case не
 * запишет в БД или не применит в расчёте мусорную ставку.
 */
import { Decimal } from 'decimal.js'

import { AffiliateRateOutOfRangeError } from '../errors/affiliate.errors'

/** Ставка RevShare в виде нормализованной decimal-строки ("0.2000"). */
export type RevShareRate = string

/** Минимальная и максимальная ставка. 1.0 = 100% от NGR (юридически невозможно, но валидно технически). */
export const MIN_REVSHARE_RATE = '0'
export const MAX_REVSHARE_RATE = '1'

/**
 * Нормализует и валидирует ставку.
 *
 * @throws {AffiliateRateOutOfRangeError} если значение не число или вне [0, 1]
 */
export function parseRevShareRate(input: string | number): RevShareRate {
  let decimal: Decimal
  try {
    decimal = new Decimal(typeof input === 'number' ? input.toString() : input.trim())
  } catch {
    throw new AffiliateRateOutOfRangeError(String(input))
  }
  if (!decimal.isFinite()) {
    throw new AffiliateRateOutOfRangeError(String(input))
  }
  if (decimal.lt(MIN_REVSHARE_RATE) || decimal.gt(MAX_REVSHARE_RATE)) {
    throw new AffiliateRateOutOfRangeError(decimal.toString())
  }
  return decimal.toFixed(4)
}

/** Ставка в процентах для UI ("0.2000" → "20"). Не деньги — только отображение. */
export function revShareRateToPercent(rate: RevShareRate): string {
  return new Decimal(rate).times(100).toDecimalPlaces(2).toString()
}
