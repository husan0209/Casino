import { type LabGame } from './domain/types'
import { houseRowPayout } from '../../../apps/api/src/modules/casino/domain/house-slot-game'
import { HOUSE_SLOT_CATALOG } from '../../../apps/api/src/modules/casino/infrastructure/providers/house/house-slot-games.registry'

/**
 * House-слоты для симуляции берутся из боевого каталога таблиц, а не переписаны:
 * иначе лаборатория валидировала бы другую математику.
 */
export function listLabGames(): LabGame[] {
  return HOUSE_SLOT_CATALOG.map((config) => ({
    externalGameId: config.externalGameId,
    displayName: config.displayName,
    payoutModel: config.payoutModel,
    baseRtp: config.defaultRtp,
    winRows: config.winRows,
    loseRows: config.loseRows,
    paytable: config.icons,
    paylines: config.session.numLine,
  }))
}

export function findLabGame(externalGameId: string): LabGame {
  const game = listLabGames().find((candidate) => candidate.externalGameId === externalGameId)
  if (!game) {
    throw new Error(`Лаборатория не знает игру ${externalGameId}`)
  }
  return game
}

/** Payout win-строк: ровно тот массив, который в бою уходит в лотерею. */
export function winPayoutsOf(game: LabGame): number[] {
  return game.winRows.map((row) => houseRowPayout(row, game.payoutModel))
}
