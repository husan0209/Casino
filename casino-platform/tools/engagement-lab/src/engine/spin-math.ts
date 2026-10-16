import { money } from '@casino/shared-utils'

import { type MoneyAmount, type PayoutMultiplier } from '../domain/types'

/**
 * Формула боя (originals-spin.use-case.ts:140,179): ставка = betamount*cpl*numline,
 * выигрыш = betamount*cpl*payout. Линии в знаменателе сокращаются, поэтому
 * лаборатории хватает betTotal и числа линий.
 */
export function winTotalOf(
  betTotal: MoneyAmount,
  payoutMultiplier: PayoutMultiplier,
  paylines: number,
): MoneyAmount {
  if (payoutMultiplier <= 0) {
    return '0'
  }
  return money.divide(money.multiply(betTotal, String(payoutMultiplier)), String(paylines))
}

/**
 * Выигрыш как доля от ставки: payout-множитель строки делится на число линий
 * (см. winTotalOf). §8.1 и §8.2 задают окна именно в долях ставки, поэтому
 * LDW и near-miss сравнивают с этим числом, а не с payout напрямую.
 */
export function winRatioOf(payoutMultiplier: PayoutMultiplier, paylines: number): number {
  return payoutMultiplier / paylines
}

/** Итог баланса: списание ставки, начисление выигрыша, опциональный бонус. */
export function settleBalance(args: {
  balanceBefore: MoneyAmount
  betTotal: MoneyAmount
  winTotal: MoneyAmount
  extraCredit?: MoneyAmount
}): MoneyAmount {
  const afterBet = money.subtract(args.balanceBefore, args.betTotal)
  const withWin = money.add(afterBet, args.winTotal)
  return args.extraCredit ? money.add(withWin, args.extraCredit) : withWin
}
