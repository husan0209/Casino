/**
 * House-слоты (оригиналы): предметная область.
 *
 * Строка исхода — позиционный кортеж донора ViperPro-Casino:
 * [0] символы 3x3, [1] подсвеченные ячейки, [2] выигрышные линии,
 * [3] drop-данные, [4] множитель, [5] payout-множитель ставки.
 * Выигрыш спина = cpl * betAmount * payout.
 * Типы — plain (zod-схемы для рантайм-валидации живут в infrastructure).
 */
export interface TigerActiveLine {
  index: number
  name: string
  combine: number
  way_243: number
  payout: number
  multiply: number
  win_amount: number
  active_icon: number[]
}

export type TigerSpinRow = [string[], number[], TigerActiveLine[], unknown[], number, number]

/** Позиции полей строки исхода (зеркало констант донора SLOTINCONS..PAYOUT). */
export const TIGER_ROW_INDEX = {
  slotIcons: 0,
  activeIcons: 1,
  activeLines: 2,
  dropLineData: 3,
  multiplyCount: 4,
  payout: 5,
} as const

export interface TigerIcon {
  icon_name: string
  win_1: number
  win_2: number
  win_3: number
  win_4: number
  win_5: number
  win_6: number
  wild_card?: unknown
  free_spin?: unknown
  free_num?: unknown
  scaler_spin?: unknown
}

/** Документ paytable: отдаём фронту Construct как есть. */
export interface TigerIconDoc {
  success: true
  data: TigerIcon[]
  message: string
}

/** Конфиг одной house-игры: таблицы исходов + paytable. */
export interface HouseSlotGameConfig {
  externalGameId: string
  displayName: string
  winRows: TigerSpinRow[]
  loseRows: TigerSpinRow[]
  icons: TigerIconDoc
}

/**
 * Порт каталога house-слотов. Реализация — в infrastructure
 * (сгенерированные таблицы), application ходит только через порт (В5).
 */
export interface IHouseSlotGames {
  getGameConfig(externalGameId: string): HouseSlotGameConfig | null
}

/** DI-токен порта каталога house-слотов. */
export const HOUSE_SLOT_GAMES = Symbol('HOUSE_SLOT_GAMES')
