import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { type ConfigService } from '@nestjs/config'
import { describe, expect, it } from 'vitest'

import { HouseOriginalsAdapter } from './house-originals.adapter'
import { AZTEC_TARGET_RTP } from '../../../domain/aztec-game'

/**
 * Каталог house-провайдера — единственный источник того, что игрок видит на
 * плитке: название, обложку и RTP. Самописным играм (Plinko, Aztec)
 * синхронизация провайдера строку не поправит: она живёт здесь, поэтому и
 * проверяется здесь. RTP-калибровка — в спеке движка, повторять Монте-Карло
 * незачем: тут сверяется, что витрина берёт то же число.
 */
function makeAdapter(webUrl: string): HouseOriginalsAdapter {
  const config = { get: () => webUrl } as unknown as ConfigService
  return new HouseOriginalsAdapter(config)
}

async function aztecRow(): Promise<Record<string, unknown>> {
  const rows = await makeAdapter('http://localhost:3000').fetchGameList()
  const found = rows.find((row) => row.externalGameId === 'treasuresofaztec')
  return (found ?? {}) as Record<string, unknown>
}

describe('house-провайдер: Aztec в каталоге', () => {
  it('строка есть и ведёт на самописный клиент', async () => {
    const row = await aztecRow()

    expect(row.name).toBe('Treasures of Aztec')
    expect(row.type).toBe('other')
    expect(row.category).toBe('instant_games')
    expect(row.thumbnailUrl).toBe('/house/treasuresofaztec/cover.jpg')
    expect(row.hasDemo).toBe(true)
  })

  it('витринный RTP взят из калибровки движка', async () => {
    const row = await aztecRow()

    expect(Number(row.rtp)).toBe(AZTEC_TARGET_RTP)
  })

  it('лаунч отдаёт url клиента с токеном и валютой', async () => {
    const launch = await makeAdapter('https://example.test').getLaunchUrl({
      gameExternalId: 'treasuresofaztec',
      sessionToken: 'demo_treasuresofaztec_abcd',
      playerToken: '',
      currency: 'USDT_TRC20',
      language: 'ru',
      returnUrl: '',
      isDemo: true,
      isMobile: true,
      ip: '127.0.0.1',
    })

    expect(launch.url).toBe(
      'https://example.test/house/treasuresofaztec/index.html' +
        '?token=demo_treasuresofaztec_abcd&currency=USDT_TRC20',
    )
  })
})

/**
 * Обложка — то, чем игрок отличает одну игру от другой. Донорский экспорт
 * Construct кладёт в `icons/icon-512.png` заглушку движка: один и тот же знак на
 * всех одиннадцати слотах, и витрина превращается в ряд одинаковых плиток.
 * Настоящая обложка — `cover.jpg`, она в индексе.
 */
describe('house-провайдер: обложки каталога', () => {
  it('каждая строка ведёт на cover.jpg игры, и файл лежит в apps/web/public', async () => {
    const rows = await makeAdapter('http://localhost:3000').fetchGameList()
    const publicDir = join(process.cwd(), '..', 'web', 'public')

    expect(rows.length).toBeGreaterThan(10)
    for (const row of rows) {
      expect(row.thumbnailUrl, `у ${row.externalGameId} нет обложки каталога`).toBe(
        `/house/${row.externalGameId}/cover.jpg`,
      )
      const file = join(publicDir, (row.thumbnailUrl ?? '').replace(/^\//, ''))
      expect(existsSync(file), `файл обложки не найден: ${file}`).toBe(true)
    }
  })
})
