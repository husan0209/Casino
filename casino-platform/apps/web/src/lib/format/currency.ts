import Decimal from 'decimal.js'

import type { FiatCurrency } from '@/types/wallet'

function decimalsFor(currency: string, compact: boolean): number {
  if (currency === 'USDT_TRC20') return 2
  if (currency === 'BTC') return compact ? 4 : 8
  return 0
}

const FIAT_SYMBOLS: Record<string, string> = {
  RUB: '₽',
  UAH: '₴',
  BYN: 'Br',
  KZT: '₸',
  UZS: 'soʻm',
}

export function formatAmount(amount: string | number, currency: string, compact = false): string {
  const d = new Decimal(amount)
  if (!d.isFinite()) return String(amount)

  const decimals = decimalsFor(currency, compact)
  const fixed = d.toFixed(decimals)
  const [intPart, fracPart] = fixed.split('.')
  const spaced = intPart!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

  if (currency === 'USDT_TRC20') {
    const frac = fracPart && !compact ? `.${fracPart}` : decimals ? `.${fracPart ?? '00'}` : ''
    return `${spaced}${frac} USDT`.replace('. USDT', ' USDT')
  }
  if (currency === 'BTC') return `${spaced}${fracPart ? `.${fracPart}` : ''} BTC`

  const symbol = FIAT_SYMBOLS[currency]
  return `${spaced} ${symbol ?? currency}`
}

export function formatBalance(amount: string, currency: string): string {
  return formatAmount(amount, currency, true)
}

export type { FiatCurrency }
