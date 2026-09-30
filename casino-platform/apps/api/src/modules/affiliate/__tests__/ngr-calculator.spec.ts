import { describe, expect, it } from 'vitest'

import { calculateCommission, calculateNgr } from '../domain/value-objects/ngr-calculator'
import {
  parseRevShareRate,
  revShareRateToPercent,
} from '../domain/value-objects/revshare-rate.value-object'

describe('calculateNgr', () => {
  it('computes ggr as bets minus wins minus rollbacks', () => {
    const result = calculateNgr({
      betSum: '1000',
      winSum: '900',
      rollbackSum: '0',
      bonusSum: '0',
      providerFeeSum: '0',
    })

    expect(result.ggr).toBe('100.00000000')
    expect(result.ngr).toBe('100.00000000')
    expect(result.isPositive).toBe(true)
  })

  it('subtracts rollback from ggr to avoid overstating revenue', () => {
    const result = calculateNgr({
      betSum: '1000',
      winSum: '0',
      rollbackSum: '250',
      bonusSum: '0',
      providerFeeSum: '0',
    })

    expect(result.ggr).toBe('750.00000000')
  })

  it('deducts bonuses from ggr — ngr is lower than ggr', () => {
    const result = calculateNgr({
      betSum: '10000',
      winSum: '0',
      rollbackSum: '0',
      bonusSum: '1500',
      providerFeeSum: '0',
    })

    expect(result.ggr).toBe('10000.00000000')
    expect(result.ngr).toBe('8500.00000000')
  })

  it('matches the industry NGR reference example (ggr 10000, bonus 1500, fee 200 → 8300)', () => {
    const result = calculateNgr({
      betSum: '10000',
      winSum: '0',
      rollbackSum: '0',
      bonusSum: '1500',
      providerFeeSum: '200',
    })

    expect(result.ngr).toBe('8300.00000000')
  })

  it('reports negative ngr when player wins more than wagers', () => {
    const result = calculateNgr({
      betSum: '1000',
      winSum: '1700',
      rollbackSum: '0',
      bonusSum: '0',
      providerFeeSum: '0',
    })

    expect(result.ggr).toBe('-700.00000000')
    expect(result.isPositive).toBe(false)
  })

  it('treats zero activity as non-positive', () => {
    const result = calculateNgr({
      betSum: '0',
      winSum: '0',
      rollbackSum: '0',
      bonusSum: '0',
      providerFeeSum: '0',
    })

    expect(result.ngr).toBe('0.00000000')
    expect(result.isPositive).toBe(false)
  })

  it('keeps full decimal precision on fractional amounts', () => {
    const result = calculateNgr({
      betSum: '0.00000003',
      winSum: '0.00000001',
      rollbackSum: '0',
      bonusSum: '0',
      providerFeeSum: '0',
    })

    expect(result.ggr).toBe('0.00000002')
  })

  it('treats null and undefined sums as zero instead of producing NaN', () => {
    const result = calculateNgr({
      betSum: null as unknown as string,
      winSum: undefined as unknown as string,
      rollbackSum: '',
      bonusSum: '0',
      providerFeeSum: '0',
    })

    expect(result.ggr).toBe('0.00000000')
    expect(Number.isNaN(Number(result.ngr))).toBe(false)
  })
})

describe('calculateCommission', () => {
  it('applies the rate to positive ngr', () => {
    expect(calculateCommission('1000', '0.2000')).toBe('200.00000000')
  })

  it('matches the market reference: ngr 8000 at 35% → 2800', () => {
    expect(calculateCommission('8000', '0.3500')).toBe('2800.00000000')
  })

  it('returns zero for negative ngr — partner never pays for a losing player', () => {
    expect(calculateCommission('-700', '0.3500')).toBe('0.00000000')
  })

  it('returns zero for exactly zero ngr', () => {
    expect(calculateCommission('0', '0.2000')).toBe('0.00000000')
  })

  it('returns zero for zero rate', () => {
    expect(calculateCommission('1000', '0.0000')).toBe('0.00000000')
  })

  it('rounds to 8 decimals without floating point drift', () => {
    expect(calculateCommission('33.33333333', '0.1000')).toBe('3.33333333')
  })
})

describe('parseRevShareRate', () => {
  it('normalises a valid rate to 4 decimals', () => {
    expect(parseRevShareRate('0.2')).toBe('0.2000')
    expect(parseRevShareRate(' 0.35 ')).toBe('0.3500')
  })

  it('accepts boundaries 0 and 1', () => {
    expect(parseRevShareRate('0')).toBe('0.0000')
    expect(parseRevShareRate('1')).toBe('1.0000')
  })

  it('rejects rates above 100%', () => {
    expect(() => parseRevShareRate('1.5')).toThrow(/out of range/i)
  })

  it('rejects negative rates', () => {
    expect(() => parseRevShareRate('-0.1')).toThrow(/out of range/i)
  })

  it('rejects non-numeric input', () => {
    expect(() => parseRevShareRate('abc')).toThrow()
  })
})

describe('revShareRateToPercent', () => {
  it('renders the rate for the affiliate UI', () => {
    expect(revShareRateToPercent('0.2000')).toBe('20')
    expect(revShareRateToPercent('0.3500')).toBe('35')
    expect(revShareRateToPercent('0.1250')).toBe('12.5')
  })
})
