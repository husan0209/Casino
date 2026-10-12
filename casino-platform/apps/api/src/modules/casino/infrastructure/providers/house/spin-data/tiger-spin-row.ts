import { z } from 'zod'

export type {
  TigerActiveLine,
  TigerIcon,
  TigerIconDoc,
  TigerSpinRow,
} from '../../../../domain/house-slot-game'
export { TIGER_ROW_INDEX } from '../../../../domain/house-slot-game'

/** Одна выигрышная линия исхода Fortune Tiger (позиция [2] строки). */
export const TigerActiveLineSchema = z.object({
  index: z.number(),
  name: z.string(),
  combine: z.number(),
  way_243: z.number(),
  payout: z.number(),
  multiply: z.number(),
  win_amount: z.number(),
  active_icon: z.array(z.number()),
})

/**
 * Строка исхода спина — позиционный кортеж донора:
 * [символы 3x3, подсвеченные ячейки, выигрышные линии, drop-данные, множитель, payout].
 */
export const TigerSpinRowSchema = z.tuple([
  z.array(z.string()),
  z.array(z.number()),
  z.array(TigerActiveLineSchema),
  z.array(z.unknown()),
  z.number(),
  z.number(),
])

/** Запись таблицы иконок (paytable). */
export const TigerIconSchema = z.object({
  icon_name: z.string(),
  win_1: z.number(),
  win_2: z.number(),
  win_3: z.number(),
  win_4: z.number(),
  win_5: z.number(),
  win_6: z.number(),
  wild_card: z.unknown(),
  free_spin: z.unknown(),
  free_num: z.unknown(),
  scaler_spin: z.unknown(),
})

/** Документ icons донора: { success, data, message } — отдаём фронтенду как есть. */
export const TigerIconDocSchema = z.object({
  success: z.literal(true),
  data: z.array(TigerIconSchema),
  message: z.string(),
})
