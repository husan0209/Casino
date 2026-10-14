/**
 * House-слоты (оригиналы): предметная область.
 *
 * Строка исхода — позиционный кортеж донора ViperPro-Casino:
 * [0] символы сетки, [1] подсвеченные ячейки, [2] выигрышные линии,
 * [3] drop-данные (каскады), [4] множитель, [5] payout-множитель ставки.
 * Выигрыш спина = cpl * betAmount * payout.
 * Типы — plain (zod-схемы для рантайм-валидации живут в infrastructure).
 */

/**
 * Денежное поле в ФОРМАТЕ контракта Construct-фронта: число с двумя знаками
 * (клиент читает фиксированные поля и не принимает строку). Арифметики по ним
 * нет: сумма считается money/Decimal и превращается в число на самой границе
 * ответа, поэтому правило «деньги в коде — строки» (G20) здесь не нарушается.
 */
export type DonorAmount = number

export interface TigerActiveLine {
  index: number
  name: string
  combine: number
  way_243: number
  payout: number
  multiply: number
  /**
   * Заполняется сервером: в multi-line таблицах донора этого поля нет
   * (фронт ждёт деньги на каждой линии, а не только на первой).
   */
  win_amount?: DonorAmount | undefined
  active_icon: number[]
}

/** Каскад (drop) в multi-line играх донора: свои линии со своим множителем. */
export interface HouseSlotDropLine {
  WinOnDrop?: number
  TotalWay?: number
  SlotIcons?: string[]
  ActiveIcons?: number[]
  ActiveLines?: TigerActiveLine[]
  WinLogs?: string[]
}

/**
 * Строка исхода. Поле [5] у multi-line игр донора = null (выплата тогда
 * собирается по [2]/[3]), поэтому оно nullable.
 */
export type TigerSpinRow = [string[], number[], TigerActiveLine[], unknown[], number, number | null]

/** Позиции полей строки исхода (зеркало констант донора SLOTINCONS..PAYOUT). */
export const TIGER_ROW_INDEX = {
  slotIcons: 0,
  activeIcons: 1,
  activeLines: 2,
  dropLineData: 3,
  multiplyCount: 4,
  payout: 5,
} as const

/**
 * Откуда в строке берётся выплата:
 * - `single` — поле [5] (Fortune Tiger и вся «пятилинейная» ветка донора);
 * - `lines`  — сумма по линиям [2] плюс линии каскадов [3] (3x5 игры:
 *   Queen of Bounty). У донора у неё [5] = null, то есть в его же рантайме
 *   игра платит 0; расчёт взялся из статического API
 *   фронта (`public/originals/queenofbounty/api/endpoints/spin.php`).
 */
export type HouseSlotPayoutModel = 'single' | 'lines'

/** Payout-множитель строки: ставка умножается на него и на cpl * betamount. */
export function houseRowPayout(row: TigerSpinRow, model: HouseSlotPayoutModel): number {
  if (model === 'single') {
    return row[TIGER_ROW_INDEX.payout] ?? 0
  }
  const baseLines = row[TIGER_ROW_INDEX.activeLines]
  const drops = row[TIGER_ROW_INDEX.dropLineData] as HouseSlotDropLine[]
  const fromBase = baseLines.reduce((sum, line) => sum + line.payout, 0)
  const fromDrops = drops.reduce(
    (sum, drop) =>
      sum +
      (drop.ActiveLines ?? []).reduce((inner, line) => inner + line.payout * line.multiply, 0),
    0,
  )
  return fromBase + fromDrops
}

/** Выплата только по базовым линиям: фронту это отдаётся как WinOnDrop. */
export function houseRowBaseLinesPayout(row: TigerSpinRow): number {
  return row[TIGER_ROW_INDEX.activeLines].reduce((sum, line) => sum + line.payout, 0)
}

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

/**
 * Idle-блок ответа session() — стартовая сетка, которую фронт Construct
 * показывает до первого спина. Берётся из контроллера донора по игре:
 * у «пятилинейной» ветки он одинаковый, у 3x5 игр — свой (15 ячеек,
 * несколько подсвеченных линий, 243 ways).
 */
export interface HouseSlotSessionDefaults {
  iconData: string[]
  activeLines: TigerActiveLine[]
  dropLine: unknown[]
  numLine: number
  totalWay: number
  freeAmount: number
  buyFeature: number
  buyMax: number
  creditLine: number
  betSizeList: string[]
}

/**
 * Сгенерированный по игре набор данных донора: таблицы исходов, paytable и
 * idle-блок session(). Экспортируется из `spin-data/<slug>.tables.ts`.
 */
export interface HouseSlotTables {
  winRows: TigerSpinRow[]
  loseRows: TigerSpinRow[]
  icons: TigerIconDoc
  session: HouseSlotSessionDefaults
}

/**
 * Верхняя граница линий одного спина. Клиент Construct сам решает, сколько
 * линий играть: Tiger шлёт 5, Jack Frost — 20. Потолок
 * ограничивает только размер ставки, потому что RTP калибруется по этому же
 * числу (см. OriginalsSpinUseCase.drawOutcome).
 */
export const HOUSE_SLOT_MAX_PAYLINES = 20

/** Конфиг одной house-игры: таблицы исходов + paytable. */
export interface HouseSlotGameConfig {
  externalGameId: string
  displayName: string
  /** Откуда строка исхода несёт выплату (см. HouseSlotPayoutModel). */
  payoutModel: HouseSlotPayoutModel
  /**
   * RTP, который провайдер заявляет о себе при синхронизации каталога.
   * Узкие таблицы донора (максимум 15x при 5 линиях) 96% не отдают — для них
   * это реальная верхняя граница, а не пожелание. Боевое значение живёт в
   * поле games.rtp и правится админом; каталожное проверяется спеком.
   */
  defaultRtp: string
  session: HouseSlotSessionDefaults
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
