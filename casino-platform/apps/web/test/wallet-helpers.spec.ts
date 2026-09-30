import { describe, expect, it } from 'vitest'

/**
 * GAP-44: smoke-тесты для wallet helpers в web-клиенте.
 * Контракт (apps/web/src/lib/wallet/helpers.ts):
 *   - sortWallets: активный кошелёк — первый, далее с положительным available,
 *     потом пустые, потом по алфавиту currency;
 *   - findFundedAlternative: первый НЕ-активный кошелёк с available > 0;
 *   - isWalletEmpty: true если кошелька нет в списке или available <= 0;
 *   - mergeWallets: список валют = включённые гео-конфигом (даже с нулём)
 *     + профинансированные вне конфига.
 *
 * Все суммы — MoneyAmount (string), деньги сравниваются через @casino/shared-utils.
 */
import {
  findFundedAlternative,
  isWalletEmpty,
  mergeWallets,
  sortWallets,
  splitWalletsByKind,
} from '../src/lib/wallet/helpers'

import type { WalletBalance } from '../src/types/wallet'

function wb(currency: string, available: string): WalletBalance {
  return { currency, balance: available, locked: '0', available }
}

describe('mergeWallets', () => {
  it('добавляет включённые валюты с нулём — кошелёк виден до первого пополнения', () => {
    const merged = mergeWallets([wb('RUB', '100')], ['RUB', 'KZT', 'BYN'])
    expect(merged.map((w) => [w.currency, w.available])).toEqual([
      ['RUB', '100'],
      ['KZT', '0'],
      ['BYN', '0'],
    ])
  })

  it('не теряет баланс валюты, которой нет в гео-конфиге', () => {
    const merged = mergeWallets([wb('RUB', '100'), wb('USD', '5')], ['RUB'])
    expect(merged.map((w) => w.currency)).toEqual(['RUB', 'USD'])
    expect(merged[1]?.available).toBe('5')
  })

  it('пустой гео-конфиг → ровно то, что вернул API', () => {
    const merged = mergeWallets([wb('UAH', '50')], [])
    expect(merged).toEqual([wb('UAH', '50')])
  })
})

/**
 * Шторка кошелька и страница «Кошелёк» — группы «Фиат» и «Крипта». Раньше каждая
 * группа строилась своим mergeWallets по ПОЛНОМУ списку, и правило «валюты вне
 * конфига остаются» клало чужие строки в обе группы: рубль был виден и в «ФИAT»,
 * и в «КРИПТА», USDT — в «ФИAT».
 */
describe('splitWalletsByKind', () => {
  const all = [wb('RUB', '100'), wb('UAH', '0'), wb('USDT_TRC20', '84.2'), wb('BTC', '0')]

  it('крипта не попадает в фиат и наоборот', () => {
    const { fiat, crypto } = splitWalletsByKind(all, {
      enabledFiat: ['RUB', 'UAH', 'KZT'],
      enabledCrypto: ['USDT_TRC20'],
      activeCurrency: 'RUB',
    })
    expect(fiat.map((w) => w.currency)).toEqual(['RUB', 'KZT', 'UAH'])
    expect(crypto.map((w) => w.currency)).toEqual(['USDT_TRC20', 'BTC'])
  })

  it('валюта вне списков конфига остаётся в своей по коду группе (деньги не прячем)', () => {
    const { fiat, crypto } = splitWalletsByKind(
      [wb('RUB', '100'), wb('USD', '5'), wb('BTC', '0.01')],
      { enabledFiat: ['RUB'], enabledCrypto: ['USDT_TRC20'], activeCurrency: 'RUB' },
    )
    expect(fiat.map((w) => w.currency)).toEqual(['RUB', 'USD'])
    expect(crypto.map((w) => w.currency)).toEqual(['BTC', 'USDT_TRC20'])
  })

  it('активный кошелёк — первый в своей группе', () => {
    const { fiat, crypto } = splitWalletsByKind(all, {
      enabledFiat: ['RUB', 'UAH'],
      enabledCrypto: ['USDT_TRC20', 'BTC'],
      activeCurrency: 'UAH',
    })
    expect(fiat[0]?.currency).toBe('UAH')
    expect(crypto[0]?.currency).toBe('USDT_TRC20')
  })
})

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
