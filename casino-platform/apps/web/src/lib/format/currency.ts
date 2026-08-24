import Decimal from 'decimal.js'
import type { FiatCurrency } from '@/types/wallet'

function decimalsFor(currency: string, compact: boolean): number {
  if (currency === 'USDT_TRC20') return 2
  if (currency === 'BTC') return compact ? 4 : 8
  return 0
}

export function formatAmount(amount: string | number, currency: string, compact = false): string {
  const d = new Decimal(amount)
  if (!d.isFinite()) return String(amount)

  const decimals = decimalsFor(currency, compact)
  const fixed = d.toFixed(decimals)
  const [intPart, fracPart] = fixed.split('.')
  const spaced = intPart!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

  if (currency === 'RUB') return `${spaced} ₽`
  if (currency === 'UAH') return `${spaced} ₴`
  if (currency === 'BYN') return `${spaced} Br`
  if (currency === 'KZT') return `${spaced} ₸`
  if (currency === 'UZS') return `${spaced} soʻm`
  if (currency === 'USDT_TRC20') {
    const frac = fracPart && !compact ? `.${fracPart}` : decimals ? `.${fracPart ?? '00'}` : ''
    return `${spaced}${frac} USDT`.replace('. USDT', ' USDT')
  }
  if (currency === 'BTC') return `${spaced}${fracPart ? `.${fracPart}` : ''} BTC`

  return `${spaced} ${currency}`
}

export function formatBalance(amount: string, currency: string): string {
  return formatAmount(amount, currency, true)
}

export type { FiatCurrency }
