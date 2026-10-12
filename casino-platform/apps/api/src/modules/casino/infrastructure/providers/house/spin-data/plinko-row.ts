import { z } from 'zod'

/** Число рядов доски Plinko (8..16). */
export const PlinkoRowsSchema = z.union([
  z.literal(8),
  z.literal(9),
  z.literal(10),
  z.literal(11),
  z.literal(12),
  z.literal(13),
  z.literal(14),
  z.literal(15),
  z.literal(16),
])
export type PlinkoRows = z.infer<typeof PlinkoRowsSchema>

/** Уровень риска Plinko. */
export const PlinkoRiskSchema = z.union([z.literal('low'), z.literal('medium'), z.literal('high')])
export type PlinkoRisk = z.infer<typeof PlinkoRiskSchema>

/** Таблицы множителей: ряды -> риск -> лунки слева направо. */
export type PlinkoMultipliers = Record<string, Record<PlinkoRisk, number[]>>

/** Путь шарика: 0 = влево, 1 = вправо, по одному решению на ряд. */
export const PlinkoPathSchema = z.array(z.union([z.literal(0), z.literal(1)]))
export type PlinkoPath = z.infer<typeof PlinkoPathSchema>
