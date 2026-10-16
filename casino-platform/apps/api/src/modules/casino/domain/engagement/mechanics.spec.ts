import { describe, expect, it } from 'vitest'

import { DEFAULT_ENGAGEMENT_CONFIG } from './engagement-config'
import { ldwCandidateRatio, selectLdwRow, shouldApplyLdw, isLdwRow } from './ldw'
import { selectNearMissRow } from './near-miss'

import type { TigerActiveLine, TigerSpinRow } from '../house-slot-game'

const CONFIG = DEFAULT_ENGAGEMENT_CONFIG

/** Строка донора с заданной выплатой и числом совпадений на линии. */
function makeRow(payout: number, combine: number): TigerSpinRow {
  const line: TigerActiveLine = {
    index: 1,
    name: 'line-1',
    combine,
    way_243: 0,
    payout,
    multiply: 1,
    active_icon: Array.from({ length: combine }, (_, i) => i),
  }
  return [['sym-a', 'sym-a', 'sym-b'], [0, 0, 1], [line], [], combine, payout]
}

const WIN_ROWS: TigerSpinRow[] = [
  makeRow(0.1, 3),
  makeRow(0.4, 2),
  makeRow(0.5, 2),
  makeRow(0.9, 3),
  makeRow(2.5, 3),
]

describe('§8.1 LDW', () => {
  it('окно выплаты LDW — 30…60 % ставки', () => {
    expect(CONFIG.ldwMinPayoutRatio).toBe(0.3)
    expect(CONFIG.ldwMaxPayoutRatio).toBe(0.6)
  })

  it('подбирает строку строго из окна', () => {
    const { row } = selectLdwRow({
      winRows: WIN_ROWS,
      payoutModel: 'single',
      config: CONFIG,
      random: () => 0,
    })
    expect(row).not.toBeNull()
    expect(isLdwRow({ row: row as TigerSpinRow, payoutModel: 'single', config: CONFIG })).toBe(true)
    expect(houseRowPayoutOf(row as TigerSpinRow)).toBeLessThanOrEqual(0.6)
  })

  it('не применяет LDW в COOLDOWN и DORMANT (§17)', () => {
    for (const phase of ['cooldown', 'dormant'] as const) {
      const decision = shouldApplyLdw({
        phase,
        spinsSinceLastLdw: 100,
        config: CONFIG,
        random: () => 0.9,
      })
      expect(decision.apply).toBe(false)
      expect(decision.reason).toBe('terminal_phase')
    }
  })

  it('уважает выключатель LDW', () => {
    const decision = shouldApplyLdw({
      phase: 'risk',
      spinsSinceLastLdw: 100,
      config: { ...CONFIG, ldwEnabled: false },
      random: () => 0.9,
    })
    expect(decision.apply).toBe(false)
    expect(decision.reason).toBe('disabled_by_flag')
  })

  it('в RETENTION ждёт интервал 3–4 спина (§5.3)', () => {
    const tooSoon = shouldApplyLdw({
      phase: 'retention',
      spinsSinceLastLdw: 1,
      config: CONFIG,
      random: () => 0.5,
    })
    expect(tooSoon.apply).toBe(false)
    expect(tooSoon.reason).toBe('dither_interval_not_reached')
  })

  it('возвращает null, если в таблице нет строк нужного окна', () => {
    const narrow: TigerSpinRow[] = [makeRow(0.05, 2), makeRow(5, 3)]
    const selection = selectLdwRow({
      winRows: narrow,
      payoutModel: 'single',
      config: CONFIG,
      random: () => 0.5,
    })
    expect(selection.row).toBeNull()
    expect(selection.reason).toBe('no_candidate_row')
  })

  it('диагностика: доля строк в окне LDW считается по таблице', () => {
    // Окно 0.3…0.6 задевают строки 0.4 и 0.5 из пяти.
    expect(ldwCandidateRatio({ winRows: WIN_ROWS, payoutModel: 'single', config: CONFIG })).toBe(
      0.4,
    )
  })
})

describe('§8.2 Near-Miss', () => {
  it('не применяется в COOLDOWN и DORMANT (§17)', () => {
    for (const phase of ['cooldown', 'dormant'] as const) {
      const decision = selectNearMissRow({
        winRows: WIN_ROWS,
        payoutModel: 'single',
        phase,
        config: CONFIG,
        random: () => 0,
      })
      expect(decision.row).toBeNull()
      expect(decision.reason).toBe('terminal_phase')
    }
  })

  it('при всегда попадании в частоту выбирает паттерн с наибольшим приоритетом', () => {
    const decision = selectNearMissRow({
      winRows: WIN_ROWS,
      payoutModel: 'single',
      phase: 'reactivation',
      config: CONFIG,
      random: () => 0, // и dithering, и проверка частоты всегда проходят
    })
    expect(decision.row).not.toBeNull()
    expect(decision.reason).toBe('applied')
    expect(decision.pattern?.name).toBe('jackpot_one_off')
  })

  it('не берёт крупные выигрыши (строка дороже 2 ставок — не near-miss)', () => {
    const onlyBig: TigerSpinRow[] = [makeRow(2.5, 2)]
    const decision = selectNearMissRow({
      winRows: onlyBig,
      payoutModel: 'single',
      phase: 'retention',
      config: CONFIG,
      random: () => 0,
    })
    expect(decision.row).toBeNull()
  })

  it('не берёт строки с тремя совпадениями — это настоящий выигрыш', () => {
    const full: TigerSpinRow[] = [makeRow(0.4, 3)]
    const decision = selectNearMissRow({
      winRows: full,
      payoutModel: 'single',
      phase: 'retention',
      config: CONFIG,
      random: () => 0,
    })
    expect(decision.row).toBeNull()
  })

  it('уважает выключатель Near-Miss', () => {
    const decision = selectNearMissRow({
      winRows: WIN_ROWS,
      payoutModel: 'single',
      phase: 'risk',
      config: { ...CONFIG, nearMissEnabled: false },
      random: () => 0,
    })
    expect(decision.row).toBeNull()
    expect(decision.reason).toBe('disabled_by_flag')
  })

  it('частота ниже порога обычно не срабатывает', () => {
    let applied = 0
    for (let i = 0; i < 1000; i++) {
      const decision = selectNearMissRow({
        winRows: WIN_ROWS,
        payoutModel: 'single',
        phase: 'onboarding',
        config: CONFIG,
        // Разыгрываем dithering и бросок одним и тем же значением — так
        // проверка частоты детерминирована: 0.1 против p ≈ 0.1.
        random: () => 0.9,
      })
      if (decision.row) {
        applied++
      }
    }
    // Без dithering частота ONBOARDING = 0.10, при random()=0.9 попадание возможно
    // только там, где dithering поднял порог выше 0.9 — то есть почти никогда.
    expect(applied).toBe(0)
  })
})

function houseRowPayoutOf(row: TigerSpinRow): number {
  return row[5] ?? 0
}
