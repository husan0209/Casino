import { Injectable } from '@nestjs/common'

import { BIKINI_PARADISE_TABLES } from './spin-data/bikini-paradise.tables'
import { FORTUNE_MOUSE_TABLES } from './spin-data/fortune-mouse.tables'
import { FORTUNE_OX_TABLES } from './spin-data/fortune-ox.tables'
import { FORTUNE_PANDA_TABLES } from './spin-data/fortune-panda.tables'
import { FORTUNE_RABBIT_TABLES } from './spin-data/fortune-rabbit.tables'
import { FORTUNE_TIGER_TABLES } from './spin-data/fortune-tiger.tables'
import { HOOD_VS_WOOLF_TABLES } from './spin-data/hood-vs-woolf.tables'
import { JACK_FROST_TABLES } from './spin-data/jack-frost.tables'
import { PHOENIX_RISES_TABLES } from './spin-data/phoenix-rises.tables'
import { QUEEN_OF_BOUNTY_TABLES } from './spin-data/queen-of-bounty.tables'
import { SONGKRAN_PARTY_TABLES } from './spin-data/songkran-party.tables'
import { TigerIconDocSchema, TigerSpinRowSchema } from './spin-data/tiger-spin-row'
import { HouseSlotConfigError } from '../../../domain/errors'
import {
  HOUSE_SLOT_MAX_PAYLINES,
  houseRowPayout,
  type HouseSlotGameConfig,
  type HouseSlotPayoutModel,
  type HouseSlotTables,
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
 * Queen of Bounty — вторая модель выплаты (`lines`): у неё row[5] = null во всех
 * 620 win-строках, то есть в рантайме самого донора игра платит 0. Расчёт взят из
 * статического API фронта (public/originals/queenofbounty/api/endpoints/spin.php):
 * сумма payout по выигрышным линиям плюс линии каскадов со своими множителями.
 * 20 линий.
 *
 * Treasures of Aztec в каталога НЕТ, и вернуть её сюда «просто таблицей донора»
 * нельзя — измерено, а не на глаз:
 * - строки исходов донора у неё — те же, что у Queen of Bounty: 1041 различных
 *   массива символов, 1581 вхождение, пересечение 100 %, lose-файлы различаются
 *   только именем класса (md5 файлов разный из-за отступов — на это смотреть
 *   бессмысленно);
 * - строка описывает доску из 15 ячеек, а её же Construct-клиент рисует 6×5 плюс
 *   верхний ряд на барабанах 2–5 = 34 (текст правил в клиенте: «6-reel, 5-row …
 *   32,400 ways»). Живьём (браузер 390×844, спин через /api/vgames) это выглядит
 *   так: несколько клеток с символами, остальные — пустые плитки, и счётчик
 *   клиента рисует «216 WAYS» при нулевом выигрыше;
 * - `session()` её контроллера — копипаста Tiger'а: 9 ячеек и `num_line = 5`,
 *   при том что её же фронт шлёт `numline = 20`.
 * То есть донорская «оригинальная» Aztec — это обложка и интерфейс от Aztec поверх
 * чисел Queen of Bounty. Показывать её игроку нельзя: доска не совпадает с тем,
 * за что он получает деньги.
 */
type CatalogSource = readonly [
  externalGameId: string,
  displayName: string,
  payoutModel: HouseSlotPayoutModel,
  defaultRtp: string,
  tables: HouseSlotTables,
]

const CATALOG_SOURCES: readonly CatalogSource[] = [
  ['fortunetiger', 'Fortune Tiger', 'single', '96', FORTUNE_TIGER_TABLES],
  ['fortuneox', 'Fortune Ox', 'single', '70', FORTUNE_OX_TABLES],
  ['fortunemouse', 'Fortune Mouse', 'single', '96', FORTUNE_MOUSE_TABLES],
  ['fortunepanda', 'Fortune Panda', 'single', '70', FORTUNE_PANDA_TABLES],
  ['fortunerabbit', 'Fortune Rabbit', 'single', '96', FORTUNE_RABBIT_TABLES],
  ['hoodvswoolf', 'Hood vs Woolf', 'single', '96', HOOD_VS_WOOLF_TABLES],
  ['jackfrost', 'Jack Frost', 'single', '96', JACK_FROST_TABLES],
  ['phoenixrises', 'Phoenix Rises', 'single', '96', PHOENIX_RISES_TABLES],
  ['songkranparty', 'Songkran Party', 'single', '96', SONGKRAN_PARTY_TABLES],
  ['bikiniparadise', 'Bikini Paradise', 'single', '96', BIKINI_PARADISE_TABLES],
  ['queenofbounty', 'Queen of Bounty', 'lines', '96', QUEEN_OF_BOUNTY_TABLES],
  // Treasures of Aztec — не в каталоге: донорские таблицы описывают 15 ячеек при
  // клиенте на 34, а самописную версию под этим именем владелец снял (см. шапку).
]

export const HOUSE_SLOT_CATALOG: readonly HouseSlotGameConfig[] = CATALOG_SOURCES.map(
  ([externalGameId, displayName, payoutModel, defaultRtp, tables]) => ({
    externalGameId,
    displayName,
    payoutModel,
    defaultRtp,
    ...tables,
  }),
)

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
      throw new HouseSlotConfigError(config.externalGameId, 'empty outcome tables')
    }
    if (config.session.iconData.length === 0 || config.session.betSizeList.length === 0) {
      throw new HouseSlotConfigError(config.externalGameId, 'empty session defaults')
    }
    // num_line из session() — это то, что клиент считает своей ставкой. Число
    // линий каждого спина приходит в запросе и калибрует RTP, поэтому за
    // пределом допуска остаётся только размер ставки, а не отдача.
    if (
      !Number.isInteger(config.session.numLine) ||
      config.session.numLine < 1 ||
      config.session.numLine > HOUSE_SLOT_MAX_PAYLINES
    ) {
      throw new HouseSlotConfigError(
        config.externalGameId,
        `session num_line ${config.session.numLine} is not an integer within 1..${HOUSE_SLOT_MAX_PAYLINES}`,
      )
    }
    for (const row of [...config.winRows, ...config.loseRows]) {
      TigerSpinRowSchema.parse(row)
    }
    this.assertRowPayouts(config)
    TigerIconDocSchema.parse(config.icons)
  }

  /**
   * Лотерея решает RTP по payout win-строк, а проигрышные строки не должны
   * платить: строка без выплаты (у донора так в поле [5] у multi-line игр)
   * сделала бы недостижимый RTP молчаливым.
   */
  private assertRowPayouts(config: HouseSlotGameConfig): void {
    for (const row of config.winRows) {
      if (!(houseRowPayout(row, config.payoutModel) > 0)) {
        throw new HouseSlotConfigError(config.externalGameId, 'a win row without payout')
      }
    }
    for (const row of config.loseRows) {
      if (houseRowPayout(row, config.payoutModel) > 0) {
        throw new HouseSlotConfigError(config.externalGameId, 'a paid lose row')
      }
    }
  }
}
