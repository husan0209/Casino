import { describe, expect, it } from 'vitest'

/**
 * GAP-44: smoke-тесты для чистых функций форматирования денег в web-клиенте.
 * Контракт:
 *   - фиат RUB/UAH/BYN/KZT/UZS — целое число с разделителем тысяч (пробел) и символом валюты;
 *   - USDT_TRC20 — 2 знака после запятой, символ «USDT»;
 *   - BTC — 8 знаков (full) / 4 (compact), символ «BTC»;
 *   - нечисловой ввод — фолбэк на String(amount) (НЕ падать в UI).
 */
import { formatAmount, formatBalance } from '../src/lib/format/currency'

describe('GAP-44 formatAmount', () => {
  describe('fiat currencies (RUB/UAH/BYN/KZT/UZS)', () => {
    it('RUB: целое число с разделителем тысяч и символом ₽', () => {
      expect(formatAmount('1500', 'RUB')).toBe('1 500 ₽')
      expect(formatAmount('1234567', 'RUB')).toBe('1 234 567 ₽')
    })

    it('UAH/BYN/KZT/UZS: свои символы валют', () => {
      expect(formatAmount('500', 'UAH')).toBe('500 ₴')
      expect(formatAmount('500', 'BYN')).toBe('500 Br')
      expect(formatAmount('500', 'KZT')).toBe('500 ₸')
      expect(formatAmount('500', 'UZS')).toBe('500 soʻm')
    })

    it('compact=true НЕ меняет фиат (compact применим только к крипте)', () => {
      // фиат в compact-режиме остаётся как обычно: 0 знаков после запятой,
      // символ валюты; compact не добавляет .00
      expect(formatAmount('1500.99', 'RUB', true)).toBe('1 501 ₽')
    })

    it('неизвестная фиат-валюта — фолбэк на код валюты как суффикс', () => {
      expect(formatAmount('100', 'XYZ')).toBe('100 XYZ')
    })
  })

  describe('USDT_TRC20', () => {
    it('full: ровно 2 знака после запятой, без точки перед USDT', () => {
      expect(formatAmount('100', 'USDT_TRC20')).toBe('100.00 USDT')
      expect(formatAmount('1500.5', 'USDT_TRC20')).toBe('1 500.50 USDT')
    })

    it('compact: без дробной части', () => {
      expect(formatAmount('1500', 'USDT_TRC20', true)).toBe('1 500 USDT')
    })
  })

  describe('BTC', () => {
    it('full: 8 знаков после запятой', () => {
      expect(formatAmount('0.12345678', 'BTC')).toBe('0.12345678 BTC')
    })

    it('compact: 4 знака после запятой', () => {
      expect(formatAmount('0.12345678', 'BTC', true)).toBe('0.1235 BTC')
    })
  })

  describe('edge cases', () => {
    it('нечисловой ввод — фолбэк на String(amount) (НЕ падает в UI)', () => {
      // Decimal('abc') даёт NaN → isFinite() === false → return String(amount)
      expect(formatAmount('abc', 'RUB')).toBe('abc')
      expect(formatAmount(NaN, 'RUB')).toBe('NaN')
    })

    it('ноль: «0 ₽» для фиата', () => {
      expect(formatAmount('0', 'RUB')).toBe('0 ₽')
    })

    it('отрицательное число: разделитель тысяч и символ', () => {
      // Decimal корректно обрабатывает минус
      expect(formatAmount('-1500', 'RUB')).toBe('-1 500 ₽')
    })
  })
})

describe('GAP-44 formatBalance', () => {
  it('проксирует в formatAmount с compact=true', () => {
    // formatBalance используется для отображения баланса кошелька → compact.
    expect(formatBalance('0.12345678', 'BTC')).toBe('0.1235 BTC')
    expect(formatBalance('1500', 'USDT_TRC20')).toBe('1 500 USDT')
  })
})
