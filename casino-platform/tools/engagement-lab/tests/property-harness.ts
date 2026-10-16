import { SIMULATION_DEFAULTS } from '../src/config'
import { type RandomFn } from '../src/domain/types'
import { createSeededRandom } from '../src/rng'

/**
 * Минимальный property-harness вместо fast-check (§13.6): его нет в монорепо, а
 * new-dependency запрещён. Контракт тот же, что у `fc.assert(fc.property(...))`:
 * генераторы -> предикат на прогоны -> бросок с примерами нарушений.
 *
 * Детерминизм: прогон n получает собственный seed из базового
 * (mulberry32 из src/rng.ts), поэтому список нарушений воспроизводим.
 */

/** Базовый seed harness'а = SIMULATION_DEFAULTS.seed (§13.2). */
export const PROPERTY_BASE_SEED = SIMULATION_DEFAULTS.seed
export const DEFAULT_NUM_RUNS = 1000

export interface Generator<TValue> {
  readonly label: string
  sample(random: RandomFn): TValue
}

export type GeneratedValues<TShape extends Record<string, Generator<unknown>>> = {
  [TKey in keyof TShape]: TShape[TKey] extends Generator<infer TValue> ? TValue : never
}

export interface PropertyViolation {
  reason: string
  runId: number
  values: unknown
}

export interface PropertyReport {
  name: string
  numRuns: number
  baseSeed: number
  violations: PropertyViolation[]
  passed: boolean
}

/** Результат предиката: true — нарушений нет, иначе — текст причины. */
export type PropertyOutcome = true | { reason: string }

/** Смешивание базового seed и номера прогона (стабильно, без Math.random). */
export function deriveSeed(baseSeed: number, runId: number): number {
  const mixed = (baseSeed ^ Math.imul(runId + 1, 0x9e3779b1)) >>> 0
  return mixed === 0 ? 1 : mixed
}

export function seededRandomFor(runId: number, baseSeed: number = PROPERTY_BASE_SEED): RandomFn {
  return createSeededRandom(deriveSeed(baseSeed, runId))
}

/** Целое в [min,max] включительно. */
export function intGenerator(label: string, min: number, max: number): Generator<number> {
  if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
    throw new Error(`intGenerator(${label}): некорректный диапазон ${min}..${max}`)
  }
  return {
    label,
    sample: (random: RandomFn): number => min + Math.floor(random() * (max - min + 1)),
  }
}

/** Вещественное в [min,max). */
export function numberGenerator(label: string, min: number, max: number): Generator<number> {
  if (!(max > min)) {
    throw new Error(`numberGenerator(${label}): некорректный диапазон ${min}..${max}`)
  }
  return {
    label,
    sample: (random: RandomFn): number => min + random() * (max - min),
  }
}

export function pickGenerator<TValue>(label: string, items: readonly TValue[]): Generator<TValue> {
  if (items.length === 0) {
    throw new Error(`pickGenerator(${label}): пустой список`)
  }
  return {
    label,
    sample: (random: RandomFn): TValue => items[Math.floor(random() * items.length)] as TValue,
  }
}

/** Запись генераторов — аналог fc.record из §13.6. */
export function recordGenerator<TShape extends Record<string, Generator<unknown>>>(
  shape: TShape,
): Generator<GeneratedValues<TShape>> {
  const keys = Object.keys(shape) as (keyof TShape)[]
  return {
    label: keys.map((key) => String(key)).join(','),
    sample: (random: RandomFn): GeneratedValues<TShape> => {
      const values: Record<string, unknown> = {}
      keys.forEach((key) => {
        values[key as string] = (shape[key] as Generator<unknown>).sample(random)
      })
      return values as GeneratedValues<TShape>
    },
  }
}

/** Значение для конкретного runId (то, что в fast-check делает fc.sample). */
export function generateN<TValue>(
  runId: number,
  generator: Generator<TValue>,
  baseSeed: number = PROPERTY_BASE_SEED,
): TValue {
  return generator.sample(seededRandomFor(runId, baseSeed))
}

/** Общие аргументы прогона свойства: генераторы, предикат и параметры запуска. */
export interface PropertyRunArgs<TShape extends Record<string, Generator<unknown>>> {
  generators: TShape
  predicate: (values: GeneratedValues<TShape>, runId: number) => PropertyOutcome
  numRuns?: number
  baseSeed?: number
}

export interface AssertPropertyArgs<
  TShape extends Record<string, Generator<unknown>>,
> extends PropertyRunArgs<TShape> {
  name: string
}

/** Прогон свойства с броском на нарушениях — аналог fc.assert. */
export function assertProperty<TShape extends Record<string, Generator<unknown>>>(
  args: AssertPropertyArgs<TShape>,
): PropertyReport {
  const {
    name,
    generators,
    predicate,
    numRuns = DEFAULT_NUM_RUNS,
    baseSeed = PROPERTY_BASE_SEED,
  } = args
  const violations = collectViolations({ generators, predicate, numRuns, baseSeed })
  const report: PropertyReport = {
    name,
    numRuns,
    baseSeed,
    violations,
    passed: violations.length === 0,
  }
  if (!report.passed) {
    const examples = violations
      .slice(0, 5)
      .map(
        (violation) =>
          `  run ${violation.runId}: ${JSON.stringify(violation.values)} — ${violation.reason}`,
      )
      .join('\n')
    throw new Error(
      `Свойство не выполнено: ${name}\nНарушений: ${violations.length} из ${numRuns} (baseSeed=${baseSeed}).\n${examples}`,
    )
  }
  return report
}

/**
 * Тот же прогон без броска: нужен, чтобы честно измерять, сколько прогонов
 * падает на БУКВАЛЬНОМ допуске §13.6 (это результат лаборатории, а не баг).
 */
export function collectViolations<TShape extends Record<string, Generator<unknown>>>(
  args: PropertyRunArgs<TShape>,
): PropertyViolation[] {
  const { generators, predicate, numRuns = DEFAULT_NUM_RUNS, baseSeed = PROPERTY_BASE_SEED } = args
  if (!Number.isInteger(numRuns) || numRuns < 1) {
    throw new Error(`assertProperty: numRuns должно быть целым >= 1, получено ${numRuns}`)
  }
  const generator = recordGenerator(generators)
  const violations: PropertyViolation[] = []

  for (let runId = 0; runId < numRuns; runId++) {
    const values = generateN(runId, generator, baseSeed)
    let outcome: PropertyOutcome
    try {
      outcome = predicate(values, runId)
    } catch (error) {
      outcome = { reason: `предикат упал: ${String(error)}` }
    }
    if (outcome !== true) {
      violations.push({ reason: outcome.reason, runId, values })
    }
  }
  return violations
}
