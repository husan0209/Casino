import { Injectable } from '@nestjs/common'

import {
  FORTUNE_OX_ICONS,
  FORTUNE_OX_LOSE_ROWS,
  FORTUNE_OX_WIN_ROWS,
} from './spin-data/fortune-ox.tables'
import {
  FORTUNE_TIGER_ICONS,
  FORTUNE_TIGER_LOSE_ROWS,
  FORTUNE_TIGER_WIN_ROWS,
} from './spin-data/fortune-tiger.tables'
import { TigerIconDocSchema, TigerSpinRowSchema } from './spin-data/tiger-spin-row'
import {
  TIGER_ROW_INDEX,
  type HouseSlotGameConfig,
  type IHouseSlotGames,
} from '../../../domain/house-slot-game'

/**
 * Реестр house-слотов: связывает externalGameId с таблицами исходов.
 *
 * Fortune Ox намеренно едет на РОДНЫХ таблицах FortuneOX (7 win / 18 lose),
 * а не на тигриных: контроллер донора подставляет тигриные по copy-paste
 * (FortuneoxController вызывает FortuneTiger*), родные файлы при этом
 * написаны и не используются. Отклонение зафиксировано в REPORT пилота.
 * Теоретический RTP родных таблиц при rtp=70: ~53.6% (у тигра ~561%).
 */
@Injectable()
export class HouseSlotGamesRegistry implements IHouseSlotGames {
  private readonly games: ReadonlyMap<string, HouseSlotGameConfig>

  constructor() {
    const configs: HouseSlotGameConfig[] = [
      {
        externalGameId: 'fortunetiger',
        displayName: 'Fortune Tiger',
        paylines: 5,
        winRows: FORTUNE_TIGER_WIN_ROWS as HouseSlotGameConfig['winRows'],
        loseRows: FORTUNE_TIGER_LOSE_ROWS as HouseSlotGameConfig['loseRows'],
        icons: FORTUNE_TIGER_ICONS as HouseSlotGameConfig['icons'],
      },
      {
        externalGameId: 'fortuneox',
        displayName: 'Fortune Ox',
        paylines: 5,
        winRows: FORTUNE_OX_WIN_ROWS as HouseSlotGameConfig['winRows'],
        loseRows: FORTUNE_OX_LOSE_ROWS as HouseSlotGameConfig['loseRows'],
        icons: FORTUNE_OX_ICONS as HouseSlotGameConfig['icons'],
      },
    ]
    for (const config of configs) {
      this.assertValidConfig(config)
    }
    this.games = new Map(configs.map((config) => [config.externalGameId, config]))
  }

  getGameConfig(externalGameId: string): HouseSlotGameConfig | null {
    return this.games.get(externalGameId) ?? null
  }

  /** Fail-fast: битые таблицы не должны доехать до спинов. */
  private assertValidConfig(config: HouseSlotGameConfig): void {
    if (config.winRows.length === 0 || config.loseRows.length === 0) {
      throw new Error(`house slot game ${config.externalGameId} has empty outcome tables`)
    }
    if (!Number.isInteger(config.paylines) || config.paylines <= 0) {
      throw new Error(`house slot game ${config.externalGameId} has invalid paylines`)
    }
    for (const row of [...config.winRows, ...config.loseRows]) {
      TigerSpinRowSchema.parse(row)
    }
    // Лотерея решает RTP по payout win-строк: строка без payout (у донора
    // так у multi-line игр) сделала бы недостижимый RTP молчаливым.
    for (const row of config.winRows) {
      const payout = row[TIGER_ROW_INDEX.payout]
      if (!(payout > 0)) {
        throw new Error(`house slot game ${config.externalGameId} has a win row without payout`)
      }
    }
    TigerIconDocSchema.parse(config.icons)
  }
}
