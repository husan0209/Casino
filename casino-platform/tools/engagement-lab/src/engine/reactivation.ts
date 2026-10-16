import { money } from '@casino/shared-utils'

import { BALANCE_CYCLE, ZERO } from '../config'
import {
  type EngagementState,
  type MoneyAmount,
  type RandomFn,
  type ReactivationDecision,
} from '../domain/types'
import { randomInRange } from '../rng'
import { balanceRatio, roundPlaces } from './state-transitions'

/** §4.3: targetBalance.toFixed(8) — восемь знаков, как в псевдокоде ТЗ. */
const TARGET_BALANCE_PLACES = 8

function noTrigger(): ReactivationDecision {
  return { trigger: false, targetBalance: null, credit: null }
}

/**
 * §4.3: проверка точки реактивации.
 *
 * Условия: баланс < 20 % депозита, reactivationCount < MAX, и с прошлого
 * триггера прошло не меньше minSpinsBetweenReactivations спинов. Цель —
 * 70–80 % депозита, никогда не 100 % (§17).
 *
 * Возвращает и credit: настолько надо доначислить, чтобы довести баланс до
 * цели. В лаборатории credit уходит в виртуальный баланс симуляции; к кошельку
 * он не прикладывается.
 *
 * Состояние не мутирует: оркестратор применяет триггер сам через
 * markReactivation из state-transitions (§4.3 + §5.2).
 */
export function checkReactivationTrigger(
  state: EngagementState,
  currentBalance: MoneyAmount,
  random: RandomFn,
): ReactivationDecision {
  // Депозит <= 0: доля баланса не определена (и balanceRatio дал бы 0, что
  // ложно passing порог) — без триггера и без деления на ноль.
  if (!money.isGreaterThan(state.initialDeposit, ZERO)) {
    return noTrigger()
  }

  // Условие 1 (§4.2): баланс строго ниже 20 % депозита; ровно 20 % — не триггер.
  if (
    !(balanceRatio(currentBalance, state.initialDeposit) < BALANCE_CYCLE.reactivationThresholdRatio)
  ) {
    return noTrigger()
  }

  // Условие 2 (§4.2): не больше maxReactivations за сессию (§17: больше 4 — нет).
  if (state.reactivationCount >= BALANCE_CYCLE.maxReactivations) {
    return noTrigger()
  }

  // Условие 3: с прошлого триггера прошло не меньше N спинов. До первой
  // реактивации паузы нет («первая реактивация не ждёт разогрева» — прод
  // CheckReactivationUseCase: lastReactivationSpin === null;
  // PLAYER_ENGAGEMENT_OVERVIEW.md, «Отличия от буквы ТЗ»).
  // Sentinel MAX_SAFE_INTEGER ставит createInitialState, сброс — markReactivation.
  if (state.counters.spinsSinceReactivation < BALANCE_CYCLE.minSpinsBetweenReactivations) {
    return noTrigger()
  }

  const targetRatio = randomInRange(
    random,
    BALANCE_CYCLE.reactivationTargetRatioMin,
    BALANCE_CYCLE.reactivationTargetRatioMax,
  )
  const targetBalance = roundPlaces(
    money.multiply(state.initialDeposit, String(targetRatio)),
    TARGET_BALANCE_PLACES,
  )

  // §4.3 молчит про случай «цель не выше текущего баланса»: считаем триггер
  // несостоявшимся, потому что реактивация обязана доначислять, а не списывать.
  if (!money.isGreaterThan(targetBalance, currentBalance)) {
    return noTrigger()
  }

  return {
    trigger: true,
    targetBalance,
    credit: money.subtract(targetBalance, currentBalance),
  }
}
