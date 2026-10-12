import { randomBytes } from 'crypto'

import { Decimal } from 'decimal.js'

import { InvalidBetRequestError, OriginalsRtpUnreachableError } from '../../domain/errors'
import { type TigerSpinRow } from '../../domain/house-slot-game'

/**
 * Лотерея house-слота, калиброванная под целевой RTP.
 *
 * Донор тасует таблицы ровно (см. REPORT пилота §5): отдача выходит 527% у
 * Tiger и зависит от числа линий клиента. Здесь распределение строится явно:
 * доля выигрышных спинов зафиксирована, а «наклон» весов win-строк
 * (weight ∝ payout^-tilt) решается бисекцией так, чтобы матожидание выплаты
 * дало ровно целевой RTP при данном числе линий.
 *
 * RTP = hitProbability * E[payout | win] / paylines — отсюда аналитическая
 * проверка достижимости: таблицы с узким рядом выплат (Ox: максимум 15x)
 * не могут отдать 96% при реалистичной частоте выигрышей.
 */
export const HOUSE_SLOT_HIT_PROBABILITY = 0.3

/** Диапазон наклона: за границами распределение вырождается в одну строку. */
const TILT_MIN = -8
const TILT_MAX = 8
const BISECTION_STEPS = 60

export interface HouseSlotLottery {
  readonly hitProbability: number
  readonly winProbabilities: readonly number[]
}

const ZERO_LOTTERY = (winRowCount: number): HouseSlotLottery => ({
  hitProbability: 0,
  winProbabilities: new Array<number>(winRowCount).fill(0),
})

/** Равномерное [0,1) из CSPRNG: предсказуемый Math.random для денег недопустим. */
export function cryptoRandom(): number {
  return randomBytes(4).readUInt32BE(0) / 4294967296
}

/** Матожидание payout при весах payout^-tilt. */
function expectedWinPayout(payouts: readonly number[], tilt: number): number {
  let numerator = 0
  let denominator = 0
  for (const payout of payouts) {
    numerator += Math.pow(payout, 1 - tilt)
    denominator += Math.pow(payout, -tilt)
  }
  return numerator / denominator
}

/**
 * Наклон, при котором E[payout | win] равен требуемому. Требование вне
 * диапазона таблиц — OriginalsRtpUnreachableError, а не молчаливая подмена RTP.
 */
function solveTilt(args: {
  gameCode: string
  targetRtp: string
  payouts: readonly number[]
  requiredExpected: number
  paylines: number
}): number {
  const asPercent = (expected: number): string =>
    new Decimal(expected).times(HOUSE_SLOT_HIT_PROBABILITY).div(args.paylines).times(100).toFixed(2)
  const lowest = expectedWinPayout(args.payouts, TILT_MAX)
  const highest = expectedWinPayout(args.payouts, TILT_MIN)
  if (args.requiredExpected < lowest || args.requiredExpected > highest) {
    throw new OriginalsRtpUnreachableError(
      args.gameCode,
      args.targetRtp,
      `${asPercent(lowest)}..${asPercent(highest)}`,
    )
  }
  let low = TILT_MIN
  let high = TILT_MAX
  for (let step = 0; step < BISECTION_STEPS; step++) {
    const middle = (low + high) / 2
    if (expectedWinPayout(args.payouts, middle) > args.requiredExpected) {
      low = middle
    } else {
      high = middle
    }
  }
  return (low + high) / 2
}

/** Win-строки должны нести положительный payout — иначе лотерея не определена. */
function assertPayouts(gameCode: string, payouts: readonly number[]): void {
  if (payouts.length === 0) {
    throw new OriginalsRtpUnreachableError(gameCode, 'empty win table')
  }
  for (const payout of payouts) {
    if (!Number.isFinite(payout) || payout <= 0) {
      throw new OriginalsRtpUnreachableError(gameCode, `win row payout ${payout}`)
    }
  }
}

export function buildHouseSlotLottery(args: {
  gameCode: string
  winPayouts: readonly number[]
  targetRtp: string
  paylines: number
}): HouseSlotLottery {
  const rtpPercent = new Decimal(args.targetRtp)
  if (rtpPercent.lte(0)) {
    return ZERO_LOTTERY(args.winPayouts.length)
  }
  assertPayouts(args.gameCode, args.winPayouts)
  const requiredExpected = rtpPercent
    .div(100)
    .times(args.paylines)
    .div(HOUSE_SLOT_HIT_PROBABILITY)
    .toNumber()
  const tilt = solveTilt({
    gameCode: args.gameCode,
    targetRtp: args.targetRtp,
    payouts: args.winPayouts,
    requiredExpected,
    paylines: args.paylines,
  })
  const weights = args.winPayouts.map((payout) => Math.pow(payout, -tilt))
  const weightSum = weights.reduce((acc, weight) => acc + weight, 0)
  return {
    hitProbability: HOUSE_SLOT_HIT_PROBABILITY,
    winProbabilities: weights.map((weight) => (weight / weightSum) * HOUSE_SLOT_HIT_PROBABILITY),
  }
}

/**
 * Один розыгрыш: с вероятностью hitProbability — win-строка по весам,
 * иначе ровный выбор из lose-строк (все они дают payout 0).
 *
 * Для win-выборки используется тот же roll, что и в проверке выигрыша:
 * условно roll равномерен на [0, hitProbability), а пороги накопленной
 * вероятности лежат внутри этого же интервала — смещения нет.
 */
export function drawHouseSlotOutcome(args: {
  lottery: HouseSlotLottery
  winRows: readonly TigerSpinRow[]
  loseRows: readonly TigerSpinRow[]
  random: () => number
}): TigerSpinRow {
  const { lottery, winRows, loseRows, random } = args
  const roll = random()
  if (roll < lottery.hitProbability) {
    const win = pickWinRow(winRows, lottery.winProbabilities, roll)
    if (win) {
      return win
    }
  }
  const lose = pickLoseRow(loseRows, random())
  if (!lose) {
    throw new InvalidBetRequestError()
  }
  return lose
}

function pickWinRow(
  winRows: readonly TigerSpinRow[],
  probabilities: readonly number[],
  roll: number,
): TigerSpinRow | null {
  let cumulative = 0
  for (let index = 0; index < winRows.length; index++) {
    cumulative += probabilities[index] ?? 0
    if (roll < cumulative) {
      return winRows[index] ?? null
    }
  }
  return winRows[winRows.length - 1] ?? null
}

function pickLoseRow(loseRows: readonly TigerSpinRow[], draw: number): TigerSpinRow | null {
  const index = Math.min(loseRows.length - 1, Math.floor(draw * loseRows.length))
  return loseRows[index] ?? null
}
