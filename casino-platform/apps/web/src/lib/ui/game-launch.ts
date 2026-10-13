import { money } from '@casino/shared-utils'

/** Что делает тап по «Играть на деньги». */
export type RealMoneyStep = 'login' | 'deposit' | 'launch'

/**
 * Единственное место, где решается «вход / касса / запуск». До этого выбор был
 * зашит в трёх компонентах витрины, и тап по карточке у игрока без денег сразу
 * выкидывал кассу: карточку игры он не успевал увидеть.
 *
 * `balance === null` — кошелёк ещё не загружен. Клиент не выдумывает «пусто»:
 * решение остаётся за сервером, у которого тот же случай называется
 * `INSUFFICIENT_FUNDS`.
 */
export function realMoneyStep(input: { signedIn: boolean; balance: string | null }): RealMoneyStep {
  if (!input.signedIn) {
    return 'login'
  }
  if (input.balance !== null && !money.isPositive(input.balance)) {
    return 'deposit'
  }
  return 'launch'
}
