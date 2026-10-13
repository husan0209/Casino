/**
 * Комплект таблиц Plinko под целевой возврат.
 *
 * RTP игры задаёт админ одним числом, а платёж определяется таблицами
 * множителей, которые видит игрок на доске. Поэтому комплект НЕ хранится:
 * он детерминированно собирается из донорских таблиц (PLINKO_MULTIPLIERS,
 * их EV ≈ 99 %) путём пропорционального масштабирования и симметричной
 * подгонки. Клиент получает ровно тот же комплект, по которому сервер
 * считает выплату, — расхождение «на доске одно, платят другое»
 * конструктивно невозможно.
 *
 * Точность: шаг 0,01 для множителей < 10 и 1 для остальных, поэтому
 * факт может отличаться от цели на сотые доли процента — это и показывает
 * plinkoPackRtp.
 */
import { type PlinkoMultipliers, type PlinkoRisk, type PlinkoRows } from './plinko-row'
import { PLINKO_MULTIPLIERS, PLINKO_RISK_VALUES, PLINKO_ROWS_VALUES } from './plinko.tables'

/** Границы регулировки: ниже 80 % играть бессмысленно, выше 130 % — игра в минус. */
export const PLINKO_RTP_LIMITS = { min: 80, max: 130 } as const

const FLOOR_MULTIPLIER = 0.1

function binomialCoefficient(rowCount: number, slot: number): number {
  let result = 1
  const take = Math.min(slot, rowCount - slot)
  for (let step = 0; step < take; step++) {
    result = (result * (rowCount - step)) / (step + 1)
  }
  return Math.round(result)
}

/** Вероятность попадания в лунку при честной монете. */
function slotProbability(rowCount: number, slot: number): number {
  return binomialCoefficient(rowCount, slot) / 2 ** rowCount
}

export function plinkoTableRtp(table: readonly number[], rowCount: number): number {
  let expected = 0
  for (let slot = 0; slot <= rowCount; slot++) {
    expected += slotProbability(rowCount, slot) * (table[slot] as number)
  }
  return expected
}

/**
 * Шаг и формат множителя. Два знака до 10 — не косметика: на 8 рядах
 * вероятность лунки 1/256, и более грубый шаг не даёт попасть в цель
 * с обещанной точностью 0,1 %.
 */
function displayStep(value: number): number {
  return value < 10 ? 0.01 : 1
}

function roundToDisplay(value: number): number {
  if (value >= 10) {
    return Math.round(value)
  }
  return Math.max(FLOOR_MULTIPLIER, Math.round(value * 100) / 100)
}

/** Пары симметричных лунок: (0, rows), (1, rows-1), ... и центр, если он один. */
function slotPairs(rowCount: number): number[][] {
  const pairs: number[][] = []
  for (let left = 0; left <= Math.floor(rowCount / 2); left++) {
    const right = rowCount - left
    pairs.push(left === right ? [left] : [left, right])
  }
  return pairs
}

/**
 * Доска выглядит как Plinko только если множители не растут к центру.
 * Правка симметрична, поэтому проверяем левую половину.
 */
function isMonotone(table: readonly number[], rowCount: number): boolean {
  for (let slot = 0; slot < Math.floor(rowCount / 2); slot++) {
    if ((table[slot] as number) < (table[slot + 1] as number)) {
      return false
    }
  }
  return true
}

/**
 * Симметричная подгонка: шагами двигаем пары лунок так, чтобы EV таблицы
 * сошёлся к цели. Порядок — от самых вероятных лунок к краям, поэтому
 * первые шаги закрывают основной зазор, а хвосты доводят точность.
 */
function tuneToTarget(table: number[], rowCount: number, target: number): void {
  const orderedPairs = slotPairs(rowCount).sort(
    (a, b) => slotProbability(rowCount, b[0] as number) - slotProbability(rowCount, a[0] as number),
  )
  let error = plinkoTableRtp(table, rowCount) - target
  for (let iteration = 0; iteration < 400 && Math.abs(error) > 0.0002; iteration++) {
    let improved = false
    for (const pair of orderedPairs) {
      const direction = error > 0 ? -1 : 1
      const probe = pair.map(
        (slot) => (table[slot] as number) + direction * displayStep(table[slot] as number),
      )
      if (probe.some((value) => value < FLOOR_MULTIPLIER)) {
        continue
      }
      const candidate = [...table]
      pair.forEach((slot, index) => {
        candidate[slot] = roundToDisplay(probe[index] as number)
      })
      if (!isMonotone(candidate, rowCount)) {
        continue
      }
      const candidateError = plinkoTableRtp(candidate, rowCount) - target
      if (Math.abs(candidateError) < Math.abs(error) - 1e-12) {
        table.splice(0, table.length, ...candidate)
        error = candidateError
        improved = true
      }
    }
    if (!improved) {
      return
    }
  }
}

function buildPack(targetRtpPercent: number): PlinkoMultipliers {
  const pack: PlinkoMultipliers = {}
  for (const rows of PLINKO_ROWS_VALUES) {
    const byRisk = {} as Record<PlinkoRisk, number[]>
    for (const risk of PLINKO_RISK_VALUES) {
      const base = PLINKO_MULTIPLIERS[String(rows)]?.[risk] ?? []
      const baseRtp = plinkoTableRtp(base, rows)
      const scale = baseRtp > 0 ? targetRtpPercent / 100 / baseRtp : 1
      const table = base.map((value) => roundToDisplay(value * scale))
      tuneToTarget(table, rows, targetRtpPercent / 100)
      byRisk[risk] = table
    }
    pack[String(rows)] = byRisk
  }
  return pack
}

const packCache = new Map<number, PlinkoMultipliers>()

/** Комплект под цель в процентах; цель вне диапазона или нечисловая — базовый донорский. */
export function plinkoPackFor(targetRtpPercent: number | null | undefined): PlinkoMultipliers {
  const fallback = PLINKO_MULTIPLIERS
  if (typeof targetRtpPercent !== 'number' || !Number.isFinite(targetRtpPercent)) {
    return fallback
  }
  const clamped = Math.min(PLINKO_RTP_LIMITS.max, Math.max(PLINKO_RTP_LIMITS.min, targetRtpPercent))
  const key = Math.round(clamped * 100) / 100
  const cached = packCache.get(key)
  if (cached) {
    return cached
  }
  const built = buildPack(key)
  packCache.set(key, built)
  return built
}

/** Фактический возврат конкретной доски собранного комплекта (доля, не проценты). */
export function plinkoPackRtp(pack: PlinkoMultipliers, rows: PlinkoRows, risk: PlinkoRisk): number {
  const table = pack[String(rows)]?.[risk] ?? []
  return plinkoTableRtp(table, rows)
}

/** Фактический возврат по всем доскам комплекта — минимум и максимум для админки. */
export function plinkoPackRtpRange(pack: PlinkoMultipliers): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY
  let max = 0
  for (const rows of PLINKO_ROWS_VALUES) {
    for (const risk of PLINKO_RISK_VALUES) {
      const value = plinkoPackRtp(pack, rows, risk)
      min = Math.min(min, value)
      max = Math.max(max, value)
    }
  }
  return { min, max }
}
