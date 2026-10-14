import { ConfigService } from '@nestjs/config'
import { describe, expect, it } from 'vitest'

import { DEMO_GAMES } from '@casino/database'

/**
 * Демо-провайдер больше НЕ заводится сидом: десять карточек-пустышек, которые
 * ставились «чтобы витрина не выглядела пустой», из проекта убраны — игрок видит
 * только реальные игры. Сам адаптер остаётся: на нём держатся тесты запуска,
 * синхронизации и жизненного цикла игрока, где нужен провайдер без внешних
 * вызовов. Спека сторожит именно это — что список заглушки стабилен и поля
 * доходят до строки провайдера без потерь.
 */

import { DemoProviderAdapter } from '../src/modules/casino/infrastructure/providers/demo/demo-provider.adapter'

describe('демо-адаптер (тестовая подставка)', () => {
  it('список непустой и slug не повторяются', async () => {
    const adapter = new DemoProviderAdapter(new ConfigService({}))
    const rows = await adapter.fetchGameList()

    expect(DEMO_GAMES.length).toBeGreaterThan(0)
    expect(rows).toHaveLength(DEMO_GAMES.length)
    expect(new Set(rows.map((row) => row.externalGameId)).size).toBe(DEMO_GAMES.length)
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
