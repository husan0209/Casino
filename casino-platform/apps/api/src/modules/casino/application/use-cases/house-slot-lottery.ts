import { randomBytes } from 'crypto'

import { Decimal } from 'decimal.js'

import { InvalidBetRequestError, OriginalsRtpUnreachableError } from '../../domain/errors'
import { type TigerSpinRow } from '../../domain/house-slot-game'

/**
 * Лотерея house-слота, калиброванная под целевой RTP.
 *
 * Донор тасует таблицы ровно (см. REPORT пилота §5): отдача выходит 527% у
 * Tiger и зависит от числа линий клиента. Здесь распределение строится явно:
 * RTP = hitProbability * E[payout | win] / paylines, и решателей два.
 *
 * A (основной): доля выигрышных спинов зафиксирована, наклон весов win-строк
 * (weight ∝ payout^-tilt) подбирается бисекцией. Даёт привычную игру.
 * B (запасной): наклон фиксирован (1/payout), подбирается доля выигрышей — им
 * закрываются таблицы, у которых даже минимальная выплата велика (Songkran
 * Party: минимум 30x, при 30% выигрышей отдача не опускается ниже 180%).
 *
 * Если ни один решатель не попадает в диапазон — OriginalsRtpUnreachableError,
 * а не молчаливая подмена цифры в поле rtp.
 */
export const HOUSE_SLOT_HIT_PROBABILITY = 0.3

/** Верхняя граница доли выигрышей в режиме B: выше — игра без проигрышей. */
export const HOUSE_SLOT_MAX_HIT_PROBABILITY = 0.6

/** Наклон весов в режиме B: крупные выплаты реже мелких. */
const FALLBACK_TILT = 1

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

/** RTP, который даёт данное матожидание выплаты при данной доле выигрышей. */
function rtpPercentOf(expectedPayout: number, hitProbability: number, paylines: number): Decimal {
  return new Decimal(expectedPayout).times(hitProbability).div(paylines).times(100)
}

/** Веса payout^-tilt, нормированные на долю выигрышных спинов. */
function lotteryFromTilt(
  payouts: readonly number[],
  tilt: number,
  hitProbability: number,
): HouseSlotLottery {
  const weights = payouts.map((payout) => Math.pow(payout, -tilt))
  const weightSum = weights.reduce((acc, weight) => acc + weight, 0)
  return {
    hitProbability,
    winProbabilities: weights.map((weight) => (weight / weightSum) * hitProbability),
  }
}

/**
 * Решатель A: доля выигрышей фиксирована, наклон подбирается.
 * null — если целевое матожидание вне диапазона таблиц (упёрлось в min/max payout).
 */
function lotteryAtFixedHit(args: {
  targetRtp: string
  payouts: readonly number[]
  paylines: number
}): HouseSlotLottery | null {
  const requiredExpected = new Decimal(args.targetRtp)
    .div(100)
    .times(args.paylines)
    .div(HOUSE_SLOT_HIT_PROBABILITY)
    .toNumber()
  const lowest = expectedWinPayout(args.payouts, TILT_MAX)
  const highest = expectedWinPayout(args.payouts, TILT_MIN)
  if (requiredExpected < lowest || requiredExpected > highest) {
    return null
  }
  let low = TILT_MIN
  let high = TILT_MAX
  for (let step = 0; step < BISECTION_STEPS; step++) {
    const middle = (low + high) / 2
    if (expectedWinPayout(args.payouts, middle) > requiredExpected) {
      low = middle
    } else {
      high = middle
    }
  }
  return lotteryFromTilt(args.payouts, (low + high) / 2, HOUSE_SLOT_HIT_PROBABILITY)
}

/**
 * Решатель B: наклон фиксирован (1/payout), подбирается доля выигрышей.
 * null — если для целевого RTP нужно больше выигрышей, чем HOUSE_SLOT_MAX_HIT_PROBABILITY.
 */
function lotteryAtFixedTilt(args: {
  targetRtp: string
  payouts: readonly number[]
  paylines: number
}): HouseSlotLottery | null {
  const expected = expectedWinPayout(args.payouts, FALLBACK_TILT)
  const hitProbability = new Decimal(args.targetRtp)
    .times(args.paylines)
    .div(new Decimal(expected).times(100))
    .toNumber()
  if (hitProbability > HOUSE_SLOT_MAX_HIT_PROBABILITY) {
    return null
  }
  return lotteryFromTilt(args.payouts, FALLBACK_TILT, hitProbability)
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
  const request = { targetRtp: args.targetRtp, payouts: args.winPayouts, paylines: args.paylines }
  const lottery = lotteryAtFixedHit(request) ?? lotteryAtFixedTilt(request)
  if (lottery) {
    return lottery
  }
  const fixedTiltExpected = expectedWinPayout(args.winPayouts, FALLBACK_TILT)
  throw new OriginalsRtpUnreachableError(
    args.gameCode,
    args.targetRtp,
    `${rtpPercentOf(
      expectedWinPayout(args.winPayouts, TILT_MAX),
      HOUSE_SLOT_HIT_PROBABILITY,
      args.paylines,
    ).toFixed(2)}..${rtpPercentOf(
      fixedTiltExpected,
      HOUSE_SLOT_MAX_HIT_PROBABILITY,
      args.paylines,
    ).toFixed(2)}`,
  )
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
