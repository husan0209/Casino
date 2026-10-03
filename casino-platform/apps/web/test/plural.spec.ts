import { describe, expect, it } from 'vitest'

/**
 * Русские счётчики игр (apps/web/src/lib/format/plural.ts):
 * «игр» для всех чисел читается как машинный перевод, а склонение по последней
 * цифре ломается на 11–14 — их и фиксируем отдельным кейсом.
 */
import { gameCountLabel } from '../src/lib/format/plural'

describe('gameCountLabel', () => {
  it('склоняет по последней цифре', () => {
    expect(gameCountLabel(1)).toBe('1 игра')
    expect(gameCountLabel(2)).toBe('2 игры')
    expect(gameCountLabel(4)).toBe('4 игры')
    expect(gameCountLabel(5)).toBe('5 игр')
  })

  it('11–14 — всегда родительный множественный', () => {
    expect(gameCountLabel(11)).toBe('11 игр')
    expect(gameCountLabel(14)).toBe('14 игр')
  })

  it('оканчивает на цифру, а не на сотню', () => {
    expect(gameCountLabel(21)).toBe('21 игра')
    expect(gameCountLabel(101)).toBe('101 игра')
    expect(gameCountLabel(111)).toBe('111 игр')
    expect(gameCountLabel(0)).toBe('0 игр')
  })
})
