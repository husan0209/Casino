/**
 * ТЗ ч.9 §4.3 — UC-ENG-03 CheckReactivationUseCase.
 *
 * Три условия ТЗ: баланс ниже 20 % базы, не исчерпан лимит реактиваций и
 * прошло достаточно спинов с прошлой реактивации.
 *
 * Важное уточнение к псевдокоду ТЗ: условие 3 считается от `lastReactivationSpin`,
 * а не через `totalSpins - lastReactivationSpin`, иначе первая реактивация в
 * паре невозможна — на свежем состоянии разница равна нулю и пауза «в N спинов»
 * блокирует триггер до 10-го спина. Здесь до первой реактивации условие 3 не
 * действует (lastReactivationSpin === null), как и подразумевает смысл условия.
 */
import { Injectable } from '@nestjs/common'
import { Decimal } from 'decimal.js'

import type { MoneyAmount } from '@casino/shared-types'

import {
  BALANCE_THRESHOLDS,
  reactivationTargetBalanceRange,
  spinsSinceReactivation,
  type EngagementConfig,
  type EngagementState,
} from '../../../domain/engagement'

import type { RandomSource } from '../../../domain/engagement/ldw'

export interface CheckReactivationInput {
  state: EngagementState
  currentBalance: MoneyAmount
  config: EngagementConfig
  random: RandomSource
}

export interface ReactivationDecision {
  readonly trigger: boolean
  /** Куда вернуть баланс (§4.3: 70–80 % базы). null, если триггера нет. */
  readonly targetBalance: MoneyAmount | null
  /** Сумма к кредиту игроку; всегда ≥ 0. */
  readonly creditAmount: MoneyAmount
  readonly reason:
    'triggered' | 'balance_above_threshold' | 'limit_reached' | 'cooldown_between_reactivations'
  readonly balanceRatio: number
}

@Injectable()
export class CheckReactivationUseCase {
  execute(input: CheckReactivationInput): ReactivationDecision {
    const { state, currentBalance, config, random } = input

    const base = new Decimal(state.initialDeposit)
    const balance = new Decimal(currentBalance)
    // §4.1: при нулевой базе доли считать не от чего — реактивация не нужна.
    const ratio = base.lte(0) ? 1 : balance.div(base).toNumber()

    if (ratio >= BALANCE_THRESHOLDS.reactivationRatio) {
      return {
        trigger: false,
        targetBalance: null,
        creditAmount: '0',
        reason: 'balance_above_threshold',
        balanceRatio: ratio,
      }
    }

    // §4.2: 3–4 реактивации за сессию, дальше дать проиграть (COOLDOWN).
    // Лимит 0 (оператор отключил бонусы) трактуется буквально: 0 >= 0,
    // то есть реактивации выключены полностью.
    if (state.reactivationCount >= config.maxReactivations) {
      return {
        trigger: false,
        targetBalance: null,
        creditAmount: '0',
        reason: 'limit_reached',
        balanceRatio: ratio,
      }
    }

    // §4.3 условие 3: пауза между реактивациями.
    const since = spinsSinceReactivation(state)
    if (since !== null && since < config.minSpinsBetweenReactivations) {
      return {
        trigger: false,
        targetBalance: null,
        creditAmount: '0',
        reason: 'cooldown_between_reactivations',
        balanceRatio: ratio,
      }
    }

    // §4.3: случайная точка коридора 70–80 % от базы.
    const { min, max } = reactivationTargetBalanceRange(state, {
      minRatio: config.reactivationTargetMinRatio,
      maxRatio: config.reactivationTargetMaxRatio,
    })
    const span = new Decimal(max).minus(min)
    const target = new Decimal(min).plus(span.times(random())).toFixed(8)

    const credit = Decimal.max(new Decimal(target).minus(balance), new Decimal(0)).toFixed(8)

    return {
      trigger: true,
      targetBalance: target,
      creditAmount: credit,
      reason: 'triggered',
      balanceRatio: ratio,
    }
  }
}
