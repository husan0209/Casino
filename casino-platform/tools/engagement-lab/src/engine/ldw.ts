import { money } from '@casino/shared-utils'

import {
  houseRowPayout,
  type TigerSpinRow,
} from '../../../../apps/api/src/modules/casino/domain/house-slot-game'
import { LDW_CONFIG, ZERO } from '../config'
import { EngagementPhase } from '../domain/engagement-phase'
import {
  type EngagementState,
  type LabGame,
  type MoneyAmount,
  type RandomFn,
} from '../domain/types'
import { pickFrom } from '../rng'
import { winRatioOf } from './spin-math'

/**
 * §8.1 в коде ТЗ клампит скорректированную частоту снизу числом 0.01
 * (`Math.max(adjustedFrequency, 0.01)`), но само число в LDW_CONFIG не
 * вынесено. Это lab default: он нужен только чтобы 1/частота не дал бесконечность.
 */
const MIN_ADJUSTED_FREQUENCY = 0.01

/**
 * Фазы, где LDW запрещён (§17: «Не применять LDW/Near-Miss в фазе COOLDOWN»;
 * DORMANT — игрок неактивен, §5.3 не задаёт для него частоту, в config там 0).
 */
const LDW_FORBIDDEN_PHASES: readonly EngagementPhase[] = [
  EngagementPhase.COOLDOWN,
  EngagementPhase.DORMANT,
]

/**
 * §8.1: сколько спинов прошло с последнего LDW.
 *
 * Счётчик ведёт §3.1: `recordSpin` пишет в `counters.lastLdwSpin` номер спина
 * (1--based, значение `totalSpins` после этого спина), поэтому на следующем
 * спине разница равна 0. До первого LDW `lastLdwSpin = 0`, то есть отсчёт
 * идёт от начала сессии: самый первый спин не может быть LDW, окно
 * открывается только когда `totalSpins` дойдёт до интервала.
 */
export function spinsSinceLastLdw(state: EngagementState): number {
  return Math.max(0, state.totalSpins - state.counters.lastLdwSpin)
}

/**
 * §8.1: пора ли LDW. Целевая частота фазы (§5.3) + dithering ±ditherRange,
 * интервал = round(1/частота), сработал, если spinsSinceLastLdw >= интервал-1.
 *
 * Про COOLDOWN и DORMANT (§17) возвращаем false ДО обращения к random: функция
 * тогда вообще не тратит источник случайности, и последовательность random
 * для остальных фаз остаётся воспроизводимой.
 *
 * Весь random — только через переданный RandomFn (Math.random запрещён:
 * прогоны лаборатории обязаны повторяться по seed).
 */
export function shouldApplyLdw(state: EngagementState, random: RandomFn): boolean {
  const baseFrequency = LDW_CONFIG.targetFrequency[state.engagementPhase]
  if (LDW_FORBIDDEN_PHASES.includes(state.engagementPhase) || baseFrequency <= 0) {
    return false
  }

  // §8.1 dithering: равномерное смещение частоты в пределах ±ditherRange.
  const dither = (random() - 0.5) * 2 * LDW_CONFIG.ditherRange
  const adjustedFrequency = Math.max(baseFrequency + dither, MIN_ADJUSTED_FREQUENCY)
  const targetInterval = Math.round(1 / adjustedFrequency)

  return spinsSinceLastLdw(state) >= targetInterval - 1
}

/**
 * §8.1: строка, чей выигрыш укладывается в 30–60 % от ставки.
 *
 * Границы окна включительно — ровно как в коде ТЗ
 * (`ratio >= minPayoutRatio && ratio <= maxPayoutRatio`). Это важно для
 * боевых таблиц: у всей «пятилинейной» ветки минимальный payout строки = 3,
 * то есть 3/5 = 0.60 — единственный кандидат лежит В ТОЧНОСТИ на верхней
 * границе. При исключительной верхней границе окно стало бы пустым и для
 * Fortune Tiger (см. tests/ldw.spec.ts, там же зафиксирован замер).
 *
 * Доля ставки считается через winRatioOf (payout/paylines, как в бою), а не
 * через payout/betTotal, как в §8.1: payout строки — множитель линии, он от
 * размера ставки не зависит, поэтому `betTotal` здесь влияет только как
 * защита от вырожденной ставки (0 или меньше).
 *
 * null — если кандидатов нет. Это не ошибка, а результат замера (Songkran
 * Party: минимальный payout 30 при 5 линиях = 6.0 от ставки, окно пусто).
 */
export function selectLdwRow(
  game: LabGame,
  betTotal: MoneyAmount,
  random: RandomFn,
): TigerSpinRow | null {
  if (!money.isGreaterThan(betTotal, ZERO)) {
    return null
  }

  const candidates = game.winRows.filter((row) => {
    const ratio = winRatioOf(houseRowPayout(row, game.payoutModel), game.paylines)
    return ratio >= LDW_CONFIG.minPayoutRatio && ratio <= LDW_CONFIG.maxPayoutRatio
  })

  if (candidates.length === 0) {
    return null
  }

  return pickFrom(random, candidates)
}
