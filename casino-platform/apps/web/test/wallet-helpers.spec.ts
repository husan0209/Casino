import { describe, expect, it } from 'vitest'

/**
 * GAP-44: smoke-тесты для wallet helpers в web-клиенте.
 * Контракт (apps/web/src/lib/wallet/helpers.ts):
 *   - sortWallets: активный кошелёк — первый, далее с положительным available,
 *     потом пустые, потом по алфавиту currency;
 *   - findFundedAlternative: первый НЕ-активный кошелёк с available > 0;
 *   - isWalletEmpty: true если кошелька нет в списке или available <= 0.
 *
 * Все суммы — MoneyAmount (string), деньги сравниваются через @casino/shared-utils.
 */
import { findFundedAlternative, isWalletEmpty, sortWallets } from '../src/lib/wallet/helpers'
import type { WalletBalance } from '../src/types/wallet'

function wb(currency: string, available: string): WalletBalance {
  return { currency, balance: available, locked: '0', available }
}

describe('GAP-44 sortWallets', () => {
  it('активный кошелёк всегда первый, остальные в исходном отсортированном порядке', () => {
    const wallets = [wb('UAH', '0'), wb('RUB', '100'), wb('BYN', '0')]
    const sorted = sortWallets(wallets, 'RUB')
    expect(sorted[0]?.currency).toBe('RUB')
    // UAH/BYN с available=0 — по алфавиту
    expect(sorted[1]?.currency).toBe('BYN')
    expect(sorted[2]?.currency).toBe('UAH')
  })

  it('кошельки с положительным available — раньше пустых', () => {
    const wallets = [wb('A', '0'), wb('B', '10'), wb('C', '5')]
    const sorted = sortWallets(wallets, 'X')
    expect(sorted.map((w) => w.currency)).toEqual(['B', 'C', 'A'])
  })

  it('не мутирует входной массив (возвращает копию)', () => {
    const wallets = [wb('RUB', '0'), wb('UAH', '0')]
    const sorted = sortWallets(wallets, 'RUB')
    expect(sorted).not.toBe(wallets)
    expect(wallets[0]?.currency).toBe('RUB')
  })

  it('пустой массив → пустой массив', () => {
    expect(sortWallets([], 'RUB')).toEqual([])
  })
})

describe('GAP-44 findFundedAlternative', () => {
  it('возвращает первый НЕ-активный кошелёк с available > 0', () => {
    const wallets = [wb('RUB', '100'), wb('UAH', '50'), wb('BYN', '0')]
    const result = findFundedAlternative(wallets, 'RUB')
    expect(result?.currency).toBe('UAH')
  })

  it('undefined если все альтернативы пустые', () => {
    const wallets = [wb('RUB', '100'), wb('UAH', '0'), wb('BYN', '0')]
    expect(findFundedAlternative(wallets, 'RUB')).toBeUndefined()
  })

  it('undefined если активный кошелёк единственный с деньгами', () => {
    const wallets = [wb('RUB', '100'), wb('UAH', '0')]
    expect(findFundedAlternative(wallets, 'RUB')).toBeUndefined()
  })
})

describe('GAP-44 isWalletEmpty', () => {
  it('true для отсутствующего кошелька', () => {
    expect(isWalletEmpty([wb('RUB', '100')], 'UAH')).toBe(true)
  })

  it('true для available=0', () => {
    expect(isWalletEmpty([wb('RUB', '0')], 'RUB')).toBe(true)
  })

  it('true для available=0.00 (Decimal корректно парсит)', () => {
    expect(isWalletEmpty([wb('RUB', '0.00')], 'RUB')).toBe(true)
  })

  it('false для положительного available', () => {
    expect(isWalletEmpty([wb('RUB', '0.01')], 'RUB')).toBe(false)
    expect(isWalletEmpty([wb('RUB', '100')], 'RUB')).toBe(false)
  })

  it('пустой список → все валюты пустые', () => {
    expect(isWalletEmpty([], 'RUB')).toBe(true)
  })
})
