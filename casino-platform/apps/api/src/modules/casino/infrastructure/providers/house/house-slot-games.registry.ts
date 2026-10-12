import { Injectable } from '@nestjs/common'

import {
  BIKINI_PARADISE_ICONS,
  BIKINI_PARADISE_LOSE_ROWS,
  BIKINI_PARADISE_WIN_ROWS,
} from './spin-data/bikini-paradise.tables'
import {
  FORTUNE_MOUSE_ICONS,
  FORTUNE_MOUSE_LOSE_ROWS,
  FORTUNE_MOUSE_WIN_ROWS,
} from './spin-data/fortune-mouse.tables'
import {
  FORTUNE_OX_ICONS,
  FORTUNE_OX_LOSE_ROWS,
  FORTUNE_OX_WIN_ROWS,
} from './spin-data/fortune-ox.tables'
import {
  FORTUNE_PANDA_ICONS,
  FORTUNE_PANDA_LOSE_ROWS,
  FORTUNE_PANDA_WIN_ROWS,
} from './spin-data/fortune-panda.tables'
import {
  FORTUNE_RABBIT_ICONS,
  FORTUNE_RABBIT_LOSE_ROWS,
  FORTUNE_RABBIT_WIN_ROWS,
} from './spin-data/fortune-rabbit.tables'
import {
  FORTUNE_TIGER_ICONS,
  FORTUNE_TIGER_LOSE_ROWS,
  FORTUNE_TIGER_WIN_ROWS,
} from './spin-data/fortune-tiger.tables'
import {
  HOOD_VS_WOOLF_ICONS,
  HOOD_VS_WOOLF_LOSE_ROWS,
  HOOD_VS_WOOLF_WIN_ROWS,
} from './spin-data/hood-vs-woolf.tables'
import {
  JACK_FROST_ICONS,
  JACK_FROST_LOSE_ROWS,
  JACK_FROST_WIN_ROWS,
} from './spin-data/jack-frost.tables'
import {
  PHOENIX_RISES_ICONS,
  PHOENIX_RISES_LOSE_ROWS,
  PHOENIX_RISES_WIN_ROWS,
} from './spin-data/phoenix-rises.tables'
import {
  SONGKRAN_PARTY_ICONS,
  SONGKRAN_PARTY_LOSE_ROWS,
  SONGKRAN_PARTY_WIN_ROWS,
} from './spin-data/songkran-party.tables'
import { TigerIconDocSchema, TigerSpinRowSchema } from './spin-data/tiger-spin-row'
import {
  TIGER_ROW_INDEX,
  type HouseSlotGameConfig,
  type IHouseSlotGames,
} from '../../../domain/house-slot-game'

/**
 * Каталог house-слотов: externalGameId → таблицы исходов донора.
 *
 * Fortune Ox намеренно едет на РОДНЫХ таблицах FortuneOX (7 win / 18 lose),
 * а не на тигриных: контроллер донора подставляет тигриные по copy-paste
 * (FortuneoxController вызывает FortuneTiger*), родные файлы при этом
 * написаны и не используются. Отклонение зафиксировано в REPORT пилота.
 *
 * Queen of Bounty и Treasures of Aztec в каталоге нет: у них payout собирается
 * по 2-3 выигрышным линиям в row[2] (row[5] = null) и 20 линий вместо 5 —
 * это другой денежный движок, не однострочная доводка таблиц.
 */
export const HOUSE_SLOT_CATALOG: readonly HouseSlotGameConfig[] = [
  {
    externalGameId: 'fortunetiger',
    displayName: 'Fortune Tiger',
    paylines: 5,
    defaultRtp: '96',
    winRows: FORTUNE_TIGER_WIN_ROWS,
    loseRows: FORTUNE_TIGER_LOSE_ROWS,
    icons: FORTUNE_TIGER_ICONS,
  },
  {
    externalGameId: 'fortuneox',
    displayName: 'Fortune Ox',
    paylines: 5,
    defaultRtp: '70',
    winRows: FORTUNE_OX_WIN_ROWS,
    loseRows: FORTUNE_OX_LOSE_ROWS,
    icons: FORTUNE_OX_ICONS,
  },
  {
    externalGameId: 'fortunemouse',
    displayName: 'Fortune Mouse',
    paylines: 5,
    defaultRtp: '96',
    winRows: FORTUNE_MOUSE_WIN_ROWS,
    loseRows: FORTUNE_MOUSE_LOSE_ROWS,
    icons: FORTUNE_MOUSE_ICONS,
  },
  {
    externalGameId: 'fortunepanda',
    displayName: 'Fortune Panda',
    paylines: 5,
    defaultRtp: '70',
    winRows: FORTUNE_PANDA_WIN_ROWS,
    loseRows: FORTUNE_PANDA_LOSE_ROWS,
    icons: FORTUNE_PANDA_ICONS,
  },
  {
    externalGameId: 'fortunerabbit',
    displayName: 'Fortune Rabbit',
    paylines: 5,
    defaultRtp: '96',
    winRows: FORTUNE_RABBIT_WIN_ROWS,
    loseRows: FORTUNE_RABBIT_LOSE_ROWS,
    icons: FORTUNE_RABBIT_ICONS,
  },
  {
    externalGameId: 'hoodvswoolf',
    displayName: 'Hood vs Woolf',
    paylines: 5,
    defaultRtp: '96',
    winRows: HOOD_VS_WOOLF_WIN_ROWS,
    loseRows: HOOD_VS_WOOLF_LOSE_ROWS,
    icons: HOOD_VS_WOOLF_ICONS,
  },
  {
    externalGameId: 'jackfrost',
    displayName: 'Jack Frost',
    paylines: 5,
    defaultRtp: '96',
    winRows: JACK_FROST_WIN_ROWS,
    loseRows: JACK_FROST_LOSE_ROWS,
    icons: JACK_FROST_ICONS,
  },
  {
    externalGameId: 'phoenixrises',
    displayName: 'Phoenix Rises',
    paylines: 5,
    defaultRtp: '96',
    winRows: PHOENIX_RISES_WIN_ROWS,
    loseRows: PHOENIX_RISES_LOSE_ROWS,
    icons: PHOENIX_RISES_ICONS,
  },
  {
    externalGameId: 'songkranparty',
    displayName: 'Songkran Party',
    paylines: 5,
    defaultRtp: '96',
    winRows: SONGKRAN_PARTY_WIN_ROWS,
    loseRows: SONGKRAN_PARTY_LOSE_ROWS,
    icons: SONGKRAN_PARTY_ICONS,
  },
  {
    externalGameId: 'bikiniparadise',
    displayName: 'Bikini Paradise',
    paylines: 5,
    defaultRtp: '96',
    winRows: BIKINI_PARADISE_WIN_ROWS,
    loseRows: BIKINI_PARADISE_LOSE_ROWS,
    icons: BIKINI_PARADISE_ICONS,
  },
]

@Injectable()
export class HouseSlotGamesRegistry implements IHouseSlotGames {
  private readonly games: ReadonlyMap<string, HouseSlotGameConfig>

  constructor() {
    for (const config of HOUSE_SLOT_CATALOG) {
      this.assertValidConfig(config)
    }
    this.games = new Map(HOUSE_SLOT_CATALOG.map((config) => [config.externalGameId, config]))
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
