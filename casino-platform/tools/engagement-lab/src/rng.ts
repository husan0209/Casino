import { type RandomFn } from './domain/types'

/**
 * Детерминированный PRNG (mulberry32). Только для лаборатории: воспроизводимость
 * прогонов важнее криптостойкости. Для денег боевой путь использует cryptoRandom
 * из house-slot-lottery, и этот файл не должен туда попасть.
 */
export function createSeededRandom(seed: number): RandomFn {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = state
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

export function randomIntBetween(random: RandomFn, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1))
}

export function pickFrom<T>(random: RandomFn, items: readonly T[]): T {
  if (items.length === 0) {
    throw new Error('pickFrom: пустой список')
  }
  return items[Math.floor(random() * items.length)] as T
}

/** Случайная величина в диапазоне [min,max). */
export function randomInRange(random: RandomFn, min: number, max: number): number {
  return min + random() * (max - min)
}
