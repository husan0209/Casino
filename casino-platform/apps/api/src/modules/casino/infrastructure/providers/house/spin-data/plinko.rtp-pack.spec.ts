import { describe, expect, it } from 'vitest'

import {
  plinkoPackFor,
  plinkoPackRtp,
  plinkoPackRtpRange,
  plinkoTableRtp,
  PLINKO_RTP_LIMITS,
} from './plinko.rtp-pack'
import { PLINKO_MULTIPLIERS, PLINKO_RISK_VALUES, PLINKO_ROWS_VALUES } from './plinko.tables'

const EVERY_BOARD = PLINKO_ROWS_VALUES.flatMap((rows) =>
  PLINKO_RISK_VALUES.map((risk) => ({ rows, risk })),
)

describe('plinkoPackFor — базовый комплект', () => {
  it('без цели или с мусором отдаёт донорские таблицы', () => {
    expect(plinkoPackFor(null)).toBe(PLINKO_MULTIPLIERS)
    expect(plinkoPackFor(undefined)).toBe(PLINKO_MULTIPLIERS)
    expect(plinkoPackFor(Number.NaN)).toBe(PLINKO_MULTIPLIERS)
  })

  it('цель 99 воспроизводит донорский профиль', () => {
    const pack = plinkoPackFor(99)
    for (const { rows, risk } of EVERY_BOARD) {
      expect(plinkoPackRtp(pack, rows, risk)).toBeCloseTo(0.99, 3)
    }
  })
})

describe('plinkoPackFor — регулировка по цели', () => {
  it.each([80, 90, 95, 96, 97, 98, 100, 110, 120, 130])(
    'цель %i %: все 27 досок попадают в цель с точностью 0,1 %',
    (target) => {
      const pack = plinkoPackFor(target)
      for (const { rows, risk } of EVERY_BOARD) {
        const achieved = plinkoPackRtp(pack, rows, risk)
        expect(Math.abs(achieved - target / 100), `rows=${rows} risk=${risk}`).toBeLessThan(0.001)
      }
    },
  )

  it('вне диапазона — клампим, а не считаем бессмыслицу', () => {
    expect(plinkoPackRtpRange(plinkoPackFor(10)).max).toBeLessThan(0.81)
    expect(plinkoPackRtpRange(plinkoPackFor(500)).min).toBeGreaterThan(1.29)
    expect(PLINKO_RTP_LIMITS).toEqual({ min: 80, max: 130 })
  })

  it('комплект детерминирован: повторный вызов отдаёт тот же объект', () => {
    expect(plinkoPackFor(97)).toBe(plinkoPackFor(97))
    expect(plinkoPackFor(97)).toBe(plinkoPackFor(97.004))
  })
})

describe('структура собранного комплекта', () => {
  const pack = plinkoPackFor(96)

  it('каждая доска симметрична и содержит rows+1 лунок', () => {
    for (const { rows, risk } of EVERY_BOARD) {
      const table = pack[String(rows)]?.[risk] ?? []
      expect(table.length).toBe(rows + 1)
      for (let slot = 0; slot <= Math.floor(rows / 2); slot++) {
        expect(table[slot]).toBe(table[rows - slot])
      }
    }
  })

  it('нет нулевых и отрицательных множителей, дробные — не длиннее двух знаков', () => {
    for (const { rows, risk } of EVERY_BOARD) {
      for (const value of pack[String(rows)]?.[risk] ?? []) {
        expect(value).toBeGreaterThanOrEqual(0.1)
        expect(value).toBeLessThanOrEqual(2000)
        if (value < 10) {
          expect(Math.round(value * 100)).toBeCloseTo(value * 100, 6)
        } else {
          expect(Number.isInteger(value)).toBe(true)
        }
      }
    }
  })

  it('порядок множителей убывает от краёв к центру — доска выглядит как Plinko', () => {
    for (const { rows, risk } of EVERY_BOARD) {
      const table = pack[String(rows)]?.[risk] ?? []
      for (let slot = 0; slot < Math.floor(rows / 2); slot++) {
        expect(table[slot] as number).toBeGreaterThanOrEqual(table[slot + 1] as number)
      }
    }
  })
})

describe('plinkoTableRtp', () => {
  it('считает биномиальное матожидание таблицы', () => {
    const flat = Array.from({ length: 9 }, () => 1)
    expect(plinkoTableRtp(flat, 8)).toBeCloseTo(1, 10)
  })

  it('донорские таблицы тянут ≈99 %', () => {
    for (const { rows, risk } of EVERY_BOARD) {
      const table = PLINKO_MULTIPLIERS[String(rows)]?.[risk] ?? []
      expect(plinkoTableRtp(table, rows)).toBeGreaterThan(0.97)
      expect(plinkoTableRtp(table, rows)).toBeLessThan(1.0)
    }
  })
})
