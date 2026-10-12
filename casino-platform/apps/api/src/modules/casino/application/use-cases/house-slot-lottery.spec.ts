import { Decimal } from 'decimal.js'
import { describe, expect, it } from 'vitest'

import {
  HOUSE_SLOT_HIT_PROBABILITY,
  buildHouseSlotLottery,
  cryptoRandom,
  drawHouseSlotOutcome,
} from './house-slot-lottery'
import { OriginalsRtpUnreachableError } from '../../domain/errors'
import { houseRowPayout } from '../../domain/house-slot-game'
import { FORTUNE_OX_TABLES } from '../../infrastructure/providers/house/spin-data/fortune-ox.tables'
import { FORTUNE_TIGER_TABLES } from '../../infrastructure/providers/house/spin-data/fortune-tiger.tables'
import { type TigerSpinRow } from '../../infrastructure/providers/house/spin-data/tiger-spin-row'

const PAYLINES = 5

/** Детерминированный PRNG: симуляция на 200k спинов должна быть воспроизводимой. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function payoutsOf(rows: readonly TigerSpinRow[]): number[] {
  return rows.map((row) => houseRowPayout(row, 'single'))
}

/** Эмпирический RTP прогона: сумма выплат относительно ставки за спин. */
function simulateRtp(args: {
  winRows: readonly TigerSpinRow[]
  loseRows: readonly TigerSpinRow[]
  targetRtp: string
  spins: number
  seed?: number
}): { rtpPercent: Decimal; hitRate: number } {
  const lottery = buildHouseSlotLottery({
    gameCode: 'sim',
    winPayouts: payoutsOf(args.winRows),
    targetRtp: args.targetRtp,
    paylines: PAYLINES,
  })
  const random = seededRandom(args.seed ?? 20261012)
  let totalPaid = new Decimal(0)
  let wins = 0
  for (let spin = 0; spin < args.spins; spin++) {
    const outcome = drawHouseSlotOutcome({
      lottery,
      winRows: args.winRows,
      loseRows: args.loseRows,
      random,
    })
    const payout = houseRowPayout(outcome, 'single')
    if (payout > 0) {
      wins += 1
      totalPaid = totalPaid.plus(payout)
    }
  }
  const rtpPercent = totalPaid
    .div(new Decimal(args.spins).times(PAYLINES))
    .times(100)
    .toDecimalPlaces(4)
  return { rtpPercent, hitRate: wins / args.spins }
}

describe('buildHouseSlotLottery', () => {
  it('аналитическое матожидание весов даёт ровно целевой RTP', () => {
    const winPayouts = payoutsOf(FORTUNE_TIGER_TABLES.winRows)
    const lottery = buildHouseSlotLottery({
      gameCode: 'fortunetiger',
      winPayouts,
      targetRtp: '96',
      paylines: PAYLINES,
    })
    const weightedPayout = lottery.winProbabilities.reduce(
      (acc, probability, index) => acc + probability * (winPayouts[index] as number),
      0,
    )
    const rtp = new Decimal(weightedPayout).div(PAYLINES).times(100)
    expect(rtp.minus(96).abs().lt(new Decimal('0.000001'))).toBe(true)
  })

  it('сумма вероятностей win-строк равна доле выигрышных спинов', () => {
    const lottery = buildHouseSlotLottery({
      gameCode: 'fortunetiger',
      winPayouts: payoutsOf(FORTUNE_TIGER_TABLES.winRows),
      targetRtp: '96',
      paylines: PAYLINES,
    })
    const sum = lottery.winProbabilities.reduce((acc, probability) => acc + probability, 0)
    expect(sum).toBeCloseTo(HOUSE_SLOT_HIT_PROBABILITY, 12)
  })

  it('крупные выплаты весят меньше мелких', () => {
    const winRows = FORTUNE_TIGER_TABLES.winRows
    const lottery = buildHouseSlotLottery({
      gameCode: 'fortunetiger',
      winPayouts: payoutsOf(winRows),
      targetRtp: '96',
      paylines: PAYLINES,
    })
    const byPayout = winRows.map((row, index) => ({
      payout: houseRowPayout(row, 'single'),
      probability: lottery.winProbabilities[index] as number,
    }))
    const small = byPayout.find((entry) => entry.payout === 3)
    const jackpot = byPayout.find((entry) => entry.payout === 250)
    expect(small && jackpot && small.probability > jackpot.probability).toBe(true)
  })

  it('RTP 0 — лотерея без выигрышей', () => {
    const lottery = buildHouseSlotLottery({
      gameCode: 'fortunetiger',
      winPayouts: payoutsOf(FORTUNE_TIGER_TABLES.winRows),
      targetRtp: '0',
      paylines: PAYLINES,
    })
    expect(lottery.hitProbability).toBe(0)
  })

  it('отказ, если таблицы не тянут целевой RTP (у Ox максимум 15x)', () => {
    expect(() =>
      buildHouseSlotLottery({
        gameCode: 'fortuneox',
        winPayouts: payoutsOf(FORTUNE_OX_TABLES.winRows),
        targetRtp: '96',
        paylines: PAYLINES,
      }),
    ).toThrow(OriginalsRtpUnreachableError)
  })

  it('отказ, если win-строка без payout (multi-line игры донора)', () => {
    expect(() =>
      buildHouseSlotLottery({
        gameCode: 'queenofbounty',
        winPayouts: payoutsOf(FORTUNE_TIGER_TABLES.winRows).concat(0),
        targetRtp: '96',
        paylines: PAYLINES,
      }),
    ).toThrow(OriginalsRtpUnreachableError)
  })
})

describe('режим B: наклон фиксирован, подбирается доля выигрышей', () => {
  // Таблица вроде Songkran Party: минимум 30x — при 30% выигрышей отдача
  // не опускается ниже 180%, поэтому долю выигрышей уменьшает решатель B.
  const RARE_BIG_PAYOUTS = [30, 50, 100, 250]

  function fakeRows(payouts: readonly number[]): TigerSpinRow[] {
    return payouts.map((payout) => [['Symbol_1'], [1], [], [], 2, payout] as TigerSpinRow)
  }

  it('96% достигаются меньшей долей выигрышей, чем HOUSE_SLOT_HIT_PROBABILITY', () => {
    const lottery = buildHouseSlotLottery({
      gameCode: 'songkranparty',
      winPayouts: RARE_BIG_PAYOUTS,
      targetRtp: '96',
      paylines: PAYLINES,
    })
    expect(lottery.hitProbability).toBeLessThan(HOUSE_SLOT_HIT_PROBABILITY)
    expect(lottery.hitProbability).toBeGreaterThan(0)
    const weightedPayout = lottery.winProbabilities.reduce(
      (acc, probability, index) => acc + probability * (RARE_BIG_PAYOUTS[index] as number),
      0,
    )
    const rtp = new Decimal(weightedPayout).div(PAYLINES).times(100)
    expect(rtp.minus(96).abs().lt(new Decimal('0.000001'))).toBe(true)
  })

  it('симуляция режима B отдаёт целевые 96%', () => {
    const { rtpPercent, hitRate } = simulateRtp({
      winRows: fakeRows(RARE_BIG_PAYOUTS),
      loseRows: fakeRows([0]),
      targetRtp: '96',
      spins: 500_000,
      seed: 99,
    })
    // Дисперсия у редких крупных выплат выше, чем у Tiger: допуск шире,
    // точность целевого значения доказан аналитическим тестом выше.
    expect(rtpPercent.minus(96).abs().lt(new Decimal('2'))).toBe(true)
    expect(hitRate).toBeLessThan(HOUSE_SLOT_HIT_PROBABILITY)
  })

  it('узкие таблицы (3..5x) не тянут 100% ни одним решателем', () => {
    expect(() =>
      buildHouseSlotLottery({
        gameCode: 'narrow',
        winPayouts: [3, 4, 5],
        targetRtp: '100',
        paylines: PAYLINES,
      }),
    ).toThrow(OriginalsRtpUnreachableError)
  })
})

describe('drawHouseSlotOutcome', () => {
  it('проигрышный билет отдаёт lose-строку с payout 0', () => {
    const lottery = buildHouseSlotLottery({
      gameCode: 'fortunetiger',
      winPayouts: payoutsOf(FORTUNE_TIGER_TABLES.winRows),
      targetRtp: '96',
      paylines: PAYLINES,
    })
    const outcome = drawHouseSlotOutcome({
      lottery,
      winRows: FORTUNE_TIGER_TABLES.winRows,
      loseRows: FORTUNE_TIGER_TABLES.loseRows,
      random: () => 0.99,
    })
    expect(houseRowPayout(outcome, 'single')).toBe(0)
  })

  it('розыгрыш покрывает все win-строки', () => {
    const lottery = buildHouseSlotLottery({
      gameCode: 'fortunetiger',
      winPayouts: payoutsOf(FORTUNE_TIGER_TABLES.winRows),
      targetRtp: '96',
      paylines: PAYLINES,
    })
    const seen = new Set<string>()
    for (let step = 0; step < 400; step++) {
      const outcome = drawHouseSlotOutcome({
        lottery,
        winRows: FORTUNE_TIGER_TABLES.winRows,
        loseRows: FORTUNE_TIGER_TABLES.loseRows,
        random: cryptoRandom,
      })
      seen.add(JSON.stringify(outcome))
    }
    expect(seen.size).toBeGreaterThan(FORTUNE_TIGER_TABLES.winRows.length)
  })
})

/**
 * Симуляция: эмпирический RTP обязан сойтись с целевым, а не с «долей
 * win-строк в нарезке», как у донора (REPORT пилота §5: 527% на ровной тасовке).
 */
describe('house slot RTP calibration (симуляция)', () => {
  it('Fortune Tiger: 200k спинов на 96% дают 96% ± 1 п.п.', () => {
    const { rtpPercent, hitRate } = simulateRtp({
      winRows: FORTUNE_TIGER_TABLES.winRows,
      loseRows: FORTUNE_TIGER_TABLES.loseRows,
      targetRtp: '96',
      spins: 200_000,
    })
    expect(rtpPercent.minus(96).abs().lt(new Decimal('1'))).toBe(true)
    expect(hitRate).toBeCloseTo(HOUSE_SLOT_HIT_PROBABILITY, 2)
  })

  it('Fortune Tiger: 85% тоже достижимы', () => {
    const { rtpPercent } = simulateRtp({
      winRows: FORTUNE_TIGER_TABLES.winRows,
      loseRows: FORTUNE_TIGER_TABLES.loseRows,
      targetRtp: '85',
      spins: 100_000,
      seed: 7,
    })
    expect(rtpPercent.minus(85).abs().lt(new Decimal('1'))).toBe(true)
  })

  it('Fortune Ox: витринные 70% сходятся, частота выигрышей в разумных границах', () => {
    const { rtpPercent, hitRate } = simulateRtp({
      winRows: FORTUNE_OX_TABLES.winRows,
      loseRows: FORTUNE_OX_TABLES.loseRows,
      targetRtp: '70',
      spins: 200_000,
    })
    expect(rtpPercent.minus(70).abs().lt(new Decimal('1'))).toBe(true)
    expect(hitRate).toBeCloseTo(HOUSE_SLOT_HIT_PROBABILITY, 2)
  })
})
