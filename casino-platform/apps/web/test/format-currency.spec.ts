import { describe, expect, it } from 'vitest'

/**
 * GAP-44: smoke-тесты для чистых функций форматирования денег в web-клиенте.
 * Фиксирует ФАКТИЧЕСКИЙ контракт apps/web/src/lib/format/currency.ts:
 *   - фиат RUB/UAH/BYN/KZT/UZS — целое (0 знаков) с разделителем тысяч и символом;
 *   - USDT_TRC20 — ВСЕГДА 2 знака (compact не убирает дробь: decimalsFor игнорирует
 *     compact для USDT);
 *   - BTC — 8 знаков full / 4 compact;
 *   - нечисловая строка → new Decimal() БРОСАЕТ DecimalError (не фолбэк);
 *   - NaN → isFinite false → String(amount).
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

    it('compact=true НЕ меняет фиат (0 знаков, округление до целого)', () => {
      expect(formatAmount('1500.99', 'RUB', true)).toBe('1 501 ₽')
    })

    it('неизвестная фиат-валюта — фолбэк на код валюты как суффикс', () => {
      expect(formatAmount('100', 'XYZ')).toBe('100 XYZ')
    })
  })

  describe('USDT_TRC20', () => {
    it('full: ровно 2 знака после запятой', () => {
      expect(formatAmount('100', 'USDT_TRC20')).toBe('100.00 USDT')
      expect(formatAmount('1500.5', 'USDT_TRC20')).toBe('1 500.50 USDT')
    })

    it('compact: ВСЁ РАВНО 2 знака (decimalsFor для USDT игнорирует compact)', () => {
      // Контракт: USDT всегда показывает дробь. compact не убирает '.00'.
      expect(formatAmount('1500', 'USDT_TRC20', true)).toBe('1 500.00 USDT')
    })
  })

  describe('BTC', () => {
    it('full: 8 знаков после запятой', () => {
      expect(formatAmount('0.12345678', 'BTC')).toBe('0.12345678 BTC')
    })

    it('compact: 4 знака после запятой (округление)', () => {
      expect(formatAmount('0.12345678', 'BTC', true)).toBe('0.1235 BTC')
    })
  })

  describe('edge cases', () => {
    it('NaN → фолбэк на String(amount) (isFinite false)', () => {
      expect(formatAmount(NaN, 'RUB')).toBe('NaN')
    })

    it('нечисловая строка → Decimal бросает (НЕ фолбэк) — фиксируем текущий контракт', () => {
      // new Decimal('abc') кидает DecimalError. formatAmount не ловит его,
      // значит вызывающий обязан передавать валидное число. Тест-страховка:
      // если кто-то добавит try/catch-фолбэк — этот кейс напомнит обновить тест.
      expect(() => formatAmount('abc', 'RUB')).toThrow()
    })

    it('ноль: «0 ₽» для фиата', () => {
      expect(formatAmount('0', 'RUB')).toBe('0 ₽')
    })

    it('отрицательное число: разделитель тысяч и символ', () => {
      expect(formatAmount('-1500', 'RUB')).toBe('-1 500 ₽')
    })
  })
})

describe('GAP-44 formatBalance', () => {
  it('проксирует в formatAmount с compact=true', () => {
    expect(formatBalance('0.12345678', 'BTC')).toBe('0.1235 BTC')
    // USDT compact сохраняет 2 знака (см. контракт выше)
    expect(formatBalance('1500', 'USDT_TRC20')).toBe('1 500.00 USDT')
  })
})
