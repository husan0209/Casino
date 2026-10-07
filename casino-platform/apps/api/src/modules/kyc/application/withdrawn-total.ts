import type { DisplayCurrency } from '@casino/shared-config'
import { money } from '@casino/shared-utils'

import type { CountedWithdrawal } from '../domain/repositories/kyc.repository'

/**
 * Сумма выводов, которая образует порог «вывод без верификации».
 *
 * Отдельный файл, а не метод сервиса, потому что число нужны в двух местах
 * одновременно: `KycCheckService.assertCanWithdraw` по нему отказывает, а
 * `GetKycStatusUseCase` показывает его игроку на /kyc. Расхождение — это ровно
 * тот дефект, из-за которого порог депозитов вынесли в общий источник
 * (`kyc-limits.ts`): UI обещал 10 000 ₽, сервер держал 5 000 ₽.
 *
 * `amountRub` заявки — тот же RUB-эквивалент, по которому ей разрешили или
 * отказали (пишет CreateWithdrawalUseCase). Строки без него — выводы до
 * 2026-10-07, когда колонку заполняли только депозиты: они переводятся по
 * курсу валюты. Неизвестную валюту `toRubEquivalent` ценит как ₽ 1:1, то есть
 * для USDT/BTC сумма завышается — для AML-порога завысить безопаснее, чем
 * недоучесть и выпустить деньги сверх лимита.
 */
export function withdrawnRubTotal(
  rows: CountedWithdrawal[],
  toRub: (amount: string, currency: DisplayCurrency) => string,
): string {
  let total = '0'
  for (const row of rows) {
    const rub = row.amountRub ?? toRub(row.amount, row.currency as DisplayCurrency)
    total = money.add(total, rub)
  }
  return total
}
