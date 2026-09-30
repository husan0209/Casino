/**
 * Расчёт NGR и комиссии RevShare (ТЗ ч.8 §8).
 *
 * Чистая функция без I/O — по правилам слоёв domain ничего не знает о БД.
 * Вся арифметика — на decimal.js, никаких number/float (AI_DEVELOPMENT_RULES §1).
 *
 * Формула:
 *   ggr       = bet_sum − win_sum − rollback_sum
 *   ngr       = ggr − bonus_sum − provider_fee_sum
 *   commission = ngr > 0 ? ngr × revshare_rate : 0
 *
 * Почему NGR, а не GGR: GGR = ставки − выигрыши и не учитывает бонусы и
 * комиссии провайдеров. Разница 30–50% от выплаты партнёру, поэтому платить
 * с GGR — прямой финансовый убыток оператора.
 */
import { Decimal } from 'decimal.js'

import type { RevShareRate } from './revshare-rate.value-object'

/** Сырые суммы за период, собранные из game_transactions/ledger_entries. */
export interface NgrInput {
  /** Σ ставок (game_transactions.type = 'bet') */
  betSum: string
  /** Σ выигрышей (game_transactions.type = 'win') */
  winSum: string
  /** Σ отмен (game_transactions.type = 'rollback') — вычитаем, чтобы не завысить GGR */
  rollbackSum: string
  /** Σ бонусов, начисленных игроку (ledger_entries.type = 'BONUS') */
  bonusSum: string
  /** Σ комиссий game-провайдеров. В MVP всегда 0 — см. PROVIDER_FEE_NOTE */
  providerFeeSum: string
}

/** Результат расчёта периода. */
export interface NgrResult {
  ggr: string
  ngr: string
  /** GGR с вычетом бонусов и комиссий — то, что партнёр видит как «вашу прибыль» */
  ngrBreakdown: {
    betSum: string
    winSum: string
    rollbackSum: string
    bonusSum: string
    providerFeeSum: string
  }
  isPositive: boolean
}

/**
 * Комиссия провайдера в MVP всегда равна нулю.
 *
 * В `game_providers` есть поле config, но фактические комиссии провайдеров
 * НИГДЕ не рассчитываются и не пишутся в системе (см. ТЗ ч.4
 * PROVIDER_INTEGRATION_STRATEGY.md). Поэтому вычет provider_fee_sum = 0.
 *
 * Это ОСОЗНАННОЕ упрощение MVP, а не молчаливое: поле присутствует в БД и
 * DTO, чтобы при появлении реальных данных фазы 2 не менять схему.
 * Эффект на деньги: NGR завышается на комиссию провайдера (2–8% на практике).
 * См. ТЗ ч.8 §20 R2.
 */
export const PROVIDER_FEE_NOTE =
  'provider_fee_sum = 0 в MVP: комиссии game-провайдеров не рассчитываются в системе (ТЗ ч.4). ' +
  'При появлении данных фазы 2 вычет подключается без изменения схемы.'

/** Нормализует любую сумму к строке с 8 знаками, tolerating null/undefined от БД. */
function toDecimal(value: string | null | undefined): Decimal {
  if (value === null || value === undefined || value === '') {
    return new Decimal(0)
  }
  return new Decimal(value)
}

/**
 * Считает GGR и NGR за период.
 *
 * Суммы могут быть отрицательными (игрок выиграл больше, чем поставил) —
 * это штатная ситуация, а не ошибка. Решение по отрицательному NGR принимает
 * вызывающий код (UC-AFF-09), здесь только арифметика.
 */
export function calculateNgr(input: NgrInput): NgrResult {
  const betSum = toDecimal(input.betSum)
  const winSum = toDecimal(input.winSum)
  const rollbackSum = toDecimal(input.rollbackSum)
  const bonusSum = toDecimal(input.bonusSum)
  const providerFeeSum = toDecimal(input.providerFeeSum)

  const ggr = betSum.minus(winSum).minus(rollbackSum)
  const ngr = ggr.minus(bonusSum).minus(providerFeeSum)

  return {
    ggr: ggr.toFixed(8),
    ngr: ngr.toFixed(8),
    ngrBreakdown: {
      betSum: betSum.toFixed(8),
      winSum: winSum.toFixed(8),
      rollbackSum: rollbackSum.toFixed(8),
      bonusSum: bonusSum.toFixed(8),
      providerFeeSum: providerFeeSum.toFixed(8),
    },
    isPositive: ngr.gt(0),
  }
}

/**
 * Считает комиссию партнёра за период.
 *
 * При NGR <= 0 комиссия всегда 0 — партнёр не платит за убыточного игрока.
 * Решение о переносе отрицательного остатка (negative carryover) принимает
 * UC-AFF-09 на уровне настроек программы, а не здесь: калькулятор всегда
 * возвращает неотрицательную комиссию.
 */
export function calculateCommission(ngr: string, rate: RevShareRate): string {
  const ngrDecimal = new Decimal(ngr)
  if (!ngrDecimal.gt(0)) {
    return new Decimal(0).toFixed(8)
  }
  return ngrDecimal.times(new Decimal(rate)).toFixed(8)
}
