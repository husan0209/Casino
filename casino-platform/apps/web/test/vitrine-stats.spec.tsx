import { describe, expect, it } from 'vitest'

import { playersCountLabel } from '@/lib/format/plural'
import {
  bigWinLabel,
  playersOnline,
  playersTodayCount,
  VITRINE_ROTATE_MS,
} from '@/lib/ui/vitrine-stats'

const BASE = new Date(2026, 9, 3, 0, 0, 0).getTime() // полночь по местному — день целиком в сутках
const HOUR_MS = 60 * 60 * 1000
/** Бакет, выровненный по границе ротации, чтобы BASE+60с не пересекал рубеж. */
const ALIGNED = Math.ceil(BASE / VITRINE_ROTATE_MS) * VITRINE_ROTATE_MS + 60_000

/** Слаг-фикстуры: и «хедлайнеры», и обычные. */
const slugs = Array.from({ length: 40 }, (_, index) => `game-${index}-a1b2`)

describe('bigWinLabel', () => {
  it('стабилен внутри бакета и меняется между бакетами', () => {
    for (const slug of slugs) {
      expect(bigWinLabel(slug, ALIGNED)).toBe(bigWinLabel(slug, ALIGNED + 60_000))
    }
    const values = new Set(
      Array.from({ length: 24 }, (_, bucket) =>
        bigWinLabel('game-0-a1b2', ALIGNED + bucket * VITRINE_ROTATE_MS),
      ),
    )
    // За сутки плашка не должна повторяться в большинстве бакетов.
    expect(values.size).toBeGreaterThanOrEqual(18)
  })

  it('держит рублёвые коридоры и тировое распределение', () => {
    const parse = (label: string): number => Number(label.replace(/[+₽\s]/g, ''))
    const amounts = slugs.map((slug) => parse(bigWinLabel(slug, ALIGNED)))
    for (const amount of amounts) {
      expect(amount).toBeGreaterThanOrEqual(800)
      expect(amount).toBeLessThanOrEqual(150_000)
      expect(amount % 100).toBe(0)
    }
    const tiers = {
      common: amounts.filter((a) => a < 7_000).length,
      notable: amounts.filter((a) => a >= 7_000 && a < 35_000).length,
      rare: amounts.filter((a) => a >= 35_000).length,
    }
    // Все три тира достижимы на выборке из 40 игр; частые — большинство.
    expect(tiers.common).toBeGreaterThan(tiers.rare)
    expect(tiers.common).toBeGreaterThan(0)
    expect(tiers.notable).toBeGreaterThan(0)
    expect(tiers.rare).toBeGreaterThan(0)
  })
})

describe('playersOnline', () => {
  it('в пределах разумного коридора и не повторяется между бакетами', () => {
    const counts = slugs.map((slug) => playersOnline(slug, ALIGNED))
    for (const count of counts) {
      expect(count).toBeGreaterThanOrEqual(1)
      expect(count).toBeLessThanOrEqual(450)
    }
    const acrossBuckets = new Set(
      Array.from({ length: 20 }, (_, bucket) =>
        playersOnline('game-0-a1b2', ALIGNED + bucket * VITRINE_ROTATE_MS),
      ),
    )
    expect(acrossBuckets.size).toBeGreaterThanOrEqual(12)
  })

  it('днём онлайн выше ночного минимума (суточная кривая)', () => {
    const night = new Date('2026-10-03T05:00:00').getTime()
    const evening = new Date('2026-10-03T18:00:00').getTime()
    const higher = slugs.filter((slug) => playersOnline(slug, evening) > playersOnline(slug, night))
    // У подавляющего большинства игр вечерний онлайн больше ночного.
    expect(higher.length).toBeGreaterThan(slugs.length * 0.8)
  })
})

describe('playersTodayCount', () => {
  it('растёт в течение дня и меняется ото дня к дню', () => {
    let previous = 0
    for (let hour = 0; hour < 24; hour += 1) {
      const count = playersTodayCount(BASE + hour * HOUR_MS)
      expect(count).toBeGreaterThanOrEqual(previous)
      expect(count).toBeLessThanOrEqual(16_000)
      previous = count
    }
    const today = playersTodayCount(ALIGNED)
    const tomorrow = playersTodayCount(ALIGNED + 24 * HOUR_MS)
    expect(tomorrow).not.toBe(today)
  })
})

describe('playersCountLabel', () => {
  it('склоняет: 1 игрок, 4 игрока, 26 игроков, 11 игроков', () => {
    expect(playersCountLabel(1)).toBe('1 игрок')
    expect(playersCountLabel(4)).toBe('4 игрока')
    expect(playersCountLabel(26)).toBe('26 игроков')
    expect(playersCountLabel(11)).toBe('11 игроков')
  })
})
