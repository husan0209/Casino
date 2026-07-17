import Decimal from 'decimal.js'
import type { MoneyAmount, Currency } from '@casino/shared-types'
export const money = {
  add(a: MoneyAmount, b: MoneyAmount): MoneyAmount { return new Decimal(a).plus(b).toString() },
  subtract(a: MoneyAmount, b: MoneyAmount): MoneyAmount { return new Decimal(a).minus(b).toString() },
  multiply(a: MoneyAmount, factor: string | number): MoneyAmount { return new Decimal(a).times(factor).toString() },
  divide(a: MoneyAmount, divisor: string | number): MoneyAmount { return new Decimal(a).div(divisor).toString() },
  isPositive(a: MoneyAmount): boolean { return new Decimal(a).gt(0) },
  equals(a: MoneyAmount, b: MoneyAmount): boolean { return new Decimal(a).eq(b) },
  isGreaterOrEqual(a: MoneyAmount, b: MoneyAmount): boolean { return new Decimal(a).gte(b) },
  toDisplay(a: MoneyAmount, currency: Currency): string { const d = new Decimal(a); return currency==='RUB' ? d.toFixed(2) : d.toFixed(8) },
}
