import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { type ConfigService } from '@nestjs/config'
import { describe, expect, it } from 'vitest'

import { HouseOriginalsAdapter } from './house-originals.adapter'
import { HOUSE_SLOT_CATALOG } from './house-slot-games.registry'

/**
 * Каталог house-провайдера — единственный источник того, что игрок видит на
 * плитке: название, обложку и RTP. Самописной игре (Plinko) синхронизация
 * провайдера строку не поправит: она живёт здесь, поэтому и проверяется здесь.
 * RTP-калибровка — в спеке реестра, повторять Монте-Карло незачем: тут сверяется,
 * что витрина берёт то же число.
 */
function makeAdapter(webUrl: string): HouseOriginalsAdapter {
  const config = { get: () => webUrl } as unknown as ConfigService
  return new HouseOriginalsAdapter(config)
}

/**
 * Aztec в каталога нет, и это решение, а не недосмотр: донорские таблицы описывают
 * доску из 15 ячеек при её же клиенте на 34 (живьём — полдоски пустых плиток при
 * счётчике «216 WAYS»), а самописную версию под чужим именем владелец снял.
 * Спека не даёт ни вернуть строку, ни оставить на диске сироту-клиент.
 */
describe('house-провайдер: Aztec вне каталога', () => {
  it('ни провайдер, ни реестр слотов не отдают строку treasuresofaztec', async () => {
    const rows = await makeAdapter('http://localhost:3000').fetchGameList()

    expect(rows.some((row) => row.externalGameId === 'treasuresofaztec')).toBe(false)
    expect(HOUSE_SLOT_CATALOG.some((game) => game.externalGameId === 'treasuresofaztec')).toBe(
      false,
    )
  })

  it('в apps/web/public не осталось папки игры без строки каталога', () => {
    const publicDir = join(process.cwd(), '..', 'web', 'public', 'house')

    expect(existsSync(join(publicDir, 'treasuresofaztec'))).toBe(false)
  })

  it('лаунч донорского слота отдаёт url клиента с токеном и валютой', async () => {
    const launch = await makeAdapter('https://example.test').getLaunchUrl({
      gameExternalId: 'queenofbounty',
      sessionToken: 'demo_queenofbounty_abcd',
      playerToken: '',
      currency: 'USDT_TRC20',
      language: 'ru',
      returnUrl: '',
      isDemo: true,
      isMobile: true,
      ip: '127.0.0.1',
    })

    expect(launch.url).toBe(
      'https://example.test/house/queenofbounty/index.html' +
        '?token=demo_queenofbounty_abcd&currency=USDT_TRC20',
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
