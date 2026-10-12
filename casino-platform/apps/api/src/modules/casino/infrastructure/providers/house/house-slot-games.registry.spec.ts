import { Decimal } from 'decimal.js'
import { describe, expect, it } from 'vitest'

import { HOUSE_SLOT_CATALOG, HouseSlotGamesRegistry } from './house-slot-games.registry'
import { buildHouseSlotLottery } from '../../../application/use-cases/house-slot-lottery'
import { OriginalsRtpUnreachableError } from '../../../domain/errors'
import { TIGER_ROW_INDEX } from '../../../domain/house-slot-game'

/**
 * Витринный RTP живёт в конфиге каталога (от него же сид и синхронизация
 * провайдера), а здесь проверяется: он аналитически достижим таблицами игры,
 * а игры с узким рядом выплат на 96% падают, а не врут.
 */
const WINDOW_RTP = '96'

function analyticRtpPercent(gameCode: string, targetRtp: string): Decimal {
  const config = HOUSE_SLOT_CATALOG.find((game) => game.externalGameId === gameCode)
  if (!config) {
    throw new Error(`unknown house slot ${gameCode}`)
  }
  const winPayouts = config.winRows.map((row) => row[TIGER_ROW_INDEX.payout])
  const lottery = buildHouseSlotLottery({
    gameCode,
    winPayouts,
    targetRtp,
    paylines: config.paylines,
  })
  const weighted = lottery.winProbabilities.reduce(
    (acc, probability, index) => acc + probability * (winPayouts[index] as number),
    0,
  )
  return new Decimal(weighted).div(config.paylines).times(100)
}

describe('HouseSlotGamesRegistry', () => {
  it('конструируется на всех играх каталога: zod-валидация таблиц и paytable', () => {
    const registry = new HouseSlotGamesRegistry()
    for (const config of HOUSE_SLOT_CATALOG) {
      expect(registry.getGameConfig(config.externalGameId)).toBe(config)
    }
  })

  it('неизвестная игра каталога — null, а не исключение', () => {
    const registry = new HouseSlotGamesRegistry()
    expect(registry.getGameConfig('queenofbounty')).toBeNull()
  })

  it('каждая игра каталога отдаёт заявленный RTP аналитически', () => {
    for (const config of HOUSE_SLOT_CATALOG) {
      const rtp = analyticRtpPercent(config.externalGameId, config.defaultRtp)
      expect(rtp.minus(Number(config.defaultRtp)).abs().lt(new Decimal('0.001'))).toBe(true)
    }
  })

  it('большая часть каталога стоит на полных 96%', () => {
    const windowGames = HOUSE_SLOT_CATALOG.filter((config) => config.defaultRtp === WINDOW_RTP)
    expect(windowGames.length).toBeGreaterThanOrEqual(8)
  })

  it('узкие таблицы на 96% падают, а не врут в поле rtp', () => {
    const narrowGames = HOUSE_SLOT_CATALOG.filter((config) => config.defaultRtp !== WINDOW_RTP)
    expect(narrowGames.length).toBeGreaterThan(0)
    for (const config of narrowGames) {
      expect(() => analyticRtpPercent(config.externalGameId, WINDOW_RTP)).toThrow(
        OriginalsRtpUnreachableError,
      )
    }
  })
})
