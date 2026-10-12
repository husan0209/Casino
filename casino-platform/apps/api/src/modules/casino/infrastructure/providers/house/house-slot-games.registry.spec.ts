import { Decimal } from 'decimal.js'
import { describe, expect, it } from 'vitest'

import { HOUSE_SLOT_CATALOG, HouseSlotGamesRegistry } from './house-slot-games.registry'
import { buildHouseSlotLottery } from '../../../application/use-cases/house-slot-lottery'
import { OriginalsRtpUnreachableError } from '../../../domain/errors'
import {
  houseRowBaseLinesPayout,
  houseRowPayout,
  type TigerSpinRow,
} from '../../../domain/house-slot-game'

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
  const winPayouts = config.winRows.map((row) => houseRowPayout(row, config.payoutModel))
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

describe('houseRowPayout', () => {
  const ROW: TigerSpinRow = [
    ['Symbol_1', 'Symbol_2'],
    [1, 2],
    [
      {
        index: 1,
        name: 'Symbol_1',
        combine: 3,
        way_243: 1,
        payout: 20,
        multiply: 1,
        active_icon: [1],
      },
      {
        index: 2,
        name: 'Symbol_2',
        combine: 3,
        way_243: 1,
        payout: 5,
        multiply: 1,
        active_icon: [2],
      },
    ],
    [
      {
        ActiveLines: [
          {
            index: 3,
            name: 'Symbol_1',
            combine: 3,
            way_243: 1,
            payout: 10,
            multiply: 2,
            active_icon: [3],
          },
        ],
      },
    ],
    2,
    null,
  ]

  it('multi-line: сумма по линиям плюс каскады со своим множителем', () => {
    expect(houseRowPayout(ROW, 'lines')).toBe(20 + 5 + 10 * 2)
  })

  it('multi-line: WinOnDrop считает только базовые линии', () => {
    expect(houseRowBaseLinesPayout(ROW)).toBe(25)
  })

  it('single: payout берётся из поля [5]', () => {
    expect(houseRowPayout([...ROW.slice(0, 5), 7] as TigerSpinRow, 'single')).toBe(7)
  })

  it('single: null в [5] не ломает расчёт (такие строки — проигрыш)', () => {
    expect(houseRowPayout(ROW, 'single')).toBe(0)
  })
})

describe('HouseSlotGamesRegistry', () => {
  it('конструируется на всех играх каталога: zod-валидация таблиц и paytable', () => {
    const registry = new HouseSlotGamesRegistry()
    for (const config of HOUSE_SLOT_CATALOG) {
      expect(registry.getGameConfig(config.externalGameId)).toBe(config)
    }
  })

  it('игры вне каталога — null, а не исключение', () => {
    const registry = new HouseSlotGamesRegistry()
    expect(registry.getGameConfig('fortune-octopus')).toBeNull()
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
