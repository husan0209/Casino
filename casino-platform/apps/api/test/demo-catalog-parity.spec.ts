import { ConfigService } from '@nestjs/config'
import { describe, expect, it } from 'vitest'

import { DEMO_GAMES } from '@casino/database'

/**
 * Демо-каталог теперь один на два места: и сид, и адаптер читают `DEMO_GAMES`
 * из @casino/database. Спека держит то, что после этого всё ещё можно сломать:
 * размер витрины (колода на главной показывает ровно столько карт) и маппинг
 * полей строки сида в строку провайдера.
 */

import { DemoProviderAdapter } from '../src/modules/casino/infrastructure/providers/demo/demo-provider.adapter'

/** Столько же, сколько показывает колода на главной (DECK_SIZE в GameDeck). */
const DECK_SIZE = 10

describe('демо-каталог', () => {
  it('витрина заполняет колоду целиком, slug не повторяются', async () => {
    const adapter = new DemoProviderAdapter(new ConfigService({}))
    const rows = await adapter.fetchGameList()

    expect(DEMO_GAMES).toHaveLength(DECK_SIZE)
    expect(rows).toHaveLength(DECK_SIZE)
    expect(new Set(rows.map((row) => row.externalGameId)).size).toBe(DECK_SIZE)
  })

  it('строка сида маппится в строку провайдера без потерь', async () => {
    const adapter = new DemoProviderAdapter(new ConfigService({}))
    const rows = await adapter.fetchGameList()

    for (const game of DEMO_GAMES) {
      const row = rows.find((candidate) => candidate.externalGameId === game.slug)
      expect(row).toBeDefined()
      expect(row?.name).toBe(game.name)
      expect(row?.rtp).toBe(game.rtp)
      expect(row?.hasDemo).toBe(true)
      expect(row?.category).toBe('slots')
    }
  })
})
