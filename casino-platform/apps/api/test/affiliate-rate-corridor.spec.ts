/**
 * Коридор ставки RevShare (5–50 %).
 *
 * Прежний диапазон `[0, 1]` пропускал и 0 %, и 100 %: одна опечатка в клетке
 * админки — и партнёр либо работает бесплатно, либо забирает всю маржу.
 * Границы держатся ОДНОЙ парой констант (`revshare-rate.value-object.ts`), а
 * settings-валидатор и Zod-схема формы их переиспользуют: три раздельных
 * диапазона в трёх слоях обязательно разъезжаются, и тогда форма принимает
 * значение, на котором падает расчёт.
 */
import { describe, expect, it } from 'vitest'

import { AFFILIATE_SETTING_KEYS, validateSettingValue } from '../src/modules/affiliate/domain/affiliate-settings'
import {
  AffiliateRateOutOfRangeError,
  AffiliateSettingsInvalidError,
} from '../src/modules/affiliate/domain/errors/affiliate.errors'
import {
  MAX_REVSHARE_RATE,
  MIN_REVSHARE_RATE,
  parseRevShareRate,
} from '../src/modules/affiliate/domain/value-objects/revshare-rate.value-object'
import { RevShareRateSchema } from '../src/modules/affiliate/presentation/dto/affiliate.dto'

describe('коридор ставки', () => {
  it('границы заданы 5 и 50 процентов', () => {
    expect(MIN_REVSHARE_RATE).toBe('0.05')
    expect(MAX_REVSHARE_RATE).toBe('0.50')
  })

  it('краи коридора включаются', () => {
    // Парсер нормализует до шага колонки DECIMAL(5,4), поэтому сверяем число, а
    // не строку: '0.05' возвращается как '0.0500'.
    expect(Number(parseRevShareRate(MIN_REVSHARE_RATE))).toBe(Number(MIN_REVSHARE_RATE))
    expect(Number(parseRevShareRate(MAX_REVSHARE_RATE))).toBe(Number(MAX_REVSHARE_RATE))
  })

  it('0 % и 100 % больше не проходят — это и был смысл правки', () => {
    expect(() => parseRevShareRate('0')).toThrow(AffiliateRateOutOfRangeError)
    expect(() => parseRevShareRate('1')).toThrow(AffiliateRateOutOfRangeError)
  })

  it('за границами — отказ, и в большую, и в меньшую сторону', () => {
    expect(() => parseRevShareRate('0.0499')).toThrow(/out of range/i)
    expect(() => parseRevShareRate('0.5001')).toThrow(/out of range/i)
  })

  it('настройка программы валидируется тем же коридором', () => {
    const key = AFFILIATE_SETTING_KEYS.defaultRevshareRate
    expect(() => validateSettingValue(key, '0.9', 'number')).toThrow(AffiliateSettingsInvalidError)
    expect(() => validateSettingValue(key, '0.25', 'number')).not.toThrow()
  })

  it('форма админки отклоняет ставку вне коридора и называет диапазон в процентах', () => {
    expect(RevShareRateSchema.safeParse('0.9').success).toBe(false)
    expect(RevShareRateSchema.safeParse('0').success).toBe(false)
    expect(RevShareRateSchema.safeParse('0.2').success).toBe(true)

    const failure = RevShareRateSchema.safeParse('0.9')
    if (!failure.success) {
      expect(failure.error.issues[0]?.message).toContain('5..50')
    }
  })
})
