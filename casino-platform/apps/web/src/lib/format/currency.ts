import { Decimal } from 'decimal.js'

import type { FiatCurrency } from '@/types/wallet'

function decimalsFor(currency: string, compact: boolean): number {
  if (currency === 'USDT_TRC20') {
    return 2
  }
  if (currency === 'BTC') {
    return compact ? 4 : 8
  }
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
  if (!d.isFinite()) {
    return String(amount)
  }

  const decimals = decimalsFor(currency, compact)
  const fixed = d.toFixed(decimals)
  const [intPart, fracPart] = fixed.split('.')
  const spaced = intPart!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

  if (currency === 'USDT_TRC20') {
    const frac = fracPart && !compact ? `.${fracPart}` : decimals ? `.${fracPart ?? '00'}` : ''
    return `${spaced}${frac} USDT`.replace('. USDT', ' USDT')
  }
  if (currency === 'BTC') {
    return `${spaced}${fracPart ? `.${fracPart}` : ''} BTC`
  }

  const symbol = FIAT_SYMBOLS[currency]
  return `${spaced} ${symbol ?? currency}`
}

export function formatBalance(amount: string, currency: string): string {
  return formatAmount(amount, currency, true)
}

const CRYPTO_LABELS: Record<string, string> = {
  USDT_TRC20: 'USDT',
  BTC: 'BTC',
}

/**
 * Короткое человекочитаемое имя валюты для UI (ТЗ ч.5 §2.5): «₽ / ₸ / soʻm» для
 * фиата, «USDT / BTC» для крипты, неизвестный код — как есть.
 *
 * Единственный источник: раньше это вычисляли в четырёх местах инлайном
 * (`formatAmount(0, cur).replace(/^0\s?/, '')`) — GAP-55.
 */
export function currencyLabel(currency: string): string {
  const crypto = CRYPTO_LABELS[currency]
  if (crypto !== undefined) {
    return crypto
  }
  return FIAT_SYMBOLS[currency] ?? currency
}

export type { FiatCurrency }
