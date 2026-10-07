import type { DisplayCurrency } from '@casino/shared-config'
import { money } from '@casino/shared-utils'

import type { CountedWithdrawal } from '../domain/repositories/kyc.repository'

/**
 * Сумма выводов, которая образует порог «вывод без верификации».
 *
 * Отдельный файл, а не метод сервиса, потому что число нужно в двух местах
 * одновременно: `KycCheckService.assertCanWithdraw` по нему отказывает, а
 * `GetKycStatusUseCase` показывает его игроку на /kyc. Расхождение — это ровно
 * тот дефект, из-за которого порог депозитов вынесли в общий источник
 * (`kyc-limits.ts`): UI обещал 10 000 ₽, сервер держал 5 000 ₽.
 *
 * `amountRub` заявки — тот же RUB-эквивалент, по которому ей разрешили или
 * отказали (пишет CreateWithdrawalUseCase, боевой курс на момент интента).
 * Строки без него — выводы до 2026-10-07, когда колонку заполнял только
 * депозитный путь: они переводятся переданным `toRub`, и вызывающий обязан
 * отдать ему ровно тот же курс, что и для своей цифры на экране. Иначе получаем
 * то, что поймал живой прогон стенда: витрина обещает 58,53 USDT по курсу 85,6,
 * а сервер отказывает уже на 55, потому что порог считался от константы 92,5.
 */
export async function withdrawnRubTotal(
  rows: CountedWithdrawal[],
  toRub: (amount: string, currency: DisplayCurrency) => string | Promise<string>,
): Promise<string> {
  let total = '0'
  for (const row of rows) {
    const rub = row.amountRub ?? (await toRub(row.amount, row.currency as DisplayCurrency))
    total = money.add(total, rub)
  }
  return total
}
