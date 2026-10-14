import { describe, expect, it } from 'vitest'

import { type DeckCard, dealDeck } from '@/components/casino/GameDeck'
import type { GameDto } from '@/types/casino'

/**
 * Раздача колоды «Колода слотов» на главной. Раньше пул обрезался до размера
 * колоды ДО перемешивания, и «кубик» менял только порядок одних и тех же карт:
 * игра, оказавшаяся за пределами первых десяти, не выпадала никогда (на живом
 * стенде так молчал Plinko). Проверки ниже держат именно это — достижимость
 * каждой игры пула, а не перестановку.
 */

const DECK_SIZE = 10

function card(slug: string, pinned = false): DeckCard {
  const game: GameDto = {
    id: `id-${slug}`,
    slug,
    name: slug,
    hasDemo: true,
    provider: { id: 'p-1', slug: 'house', name: 'House Originals' },
  }

  return { game, tag: 'Хайп', tagColor: '', pinned }
}

function pool(count: number, pinnedPrefix = 0): DeckCard[] {
  return Array.from({ length: count }, (_, index) => card(`game-${index}`, index < pinnedPrefix))
}

function slugs(cards: DeckCard[]): string[] {
  return cards.map((cardInDeck) => cardInDeck.game.slug)
}

describe('раздача колоды главной', () => {
  it('первый расклад детерминирован: идут первые size карт пула по порядку', () => {
    const deck = dealDeck(pool(16), 0, DECK_SIZE)

    expect(slugs(deck)).toEqual(slugs(pool(16)).slice(0, DECK_SIZE))
  })

  it('колода никогда не больше заявленного размера', () => {
    for (const nonce of [0, 1, 2, 7, 99]) {
      expect(dealDeck(pool(40), nonce, DECK_SIZE)).toHaveLength(DECK_SIZE)
    }
  })

  it('каждая игра пула может выпасть: за 400 пересдач покрываем все 16', () => {
    const seen = new Set<string>()

    for (let nonce = 1; nonce <= 400; nonce += 1) {
      for (const slug of slugs(dealDeck(pool(16), nonce, DECK_SIZE))) {
        seen.add(slug)
      }
    }

    expect(seen.size).toBe(16)
  })

  it('пересдача меняет СОСТАВ, а не только порядок', () => {
    const built = pool(16)
    const first = new Set(slugs(dealDeck(built, 0, DECK_SIZE)))

    const changed = Array.from({ length: 20 }, (_, index) => index + 1)
      .map((nonce) => slugs(dealDeck(built, nonce, DECK_SIZE)))
      .some((again) => again.some((slug) => !first.has(slug)))

    expect(changed).toBe(true)
  })

  it('личные карты закреплены: жеребьёвка их не прячет', () => {
    const built = pool(20, 3)

    for (let nonce = 0; nonce < 60; nonce += 1) {
      const dealt = slugs(dealDeck(built, nonce, DECK_SIZE))
      for (const pinnedSlug of ['game-0', 'game-1', 'game-2']) {
        expect(dealt).toContain(pinnedSlug)
      }
    }
  })

  it('пул меньше размера колоды раздаётся целиком без дырок', () => {
    const deck = dealDeck(pool(4), 5, DECK_SIZE)

    expect(deck).toHaveLength(4)
  })
})
