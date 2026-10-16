import { SIMULATION_DEFAULTS } from '../config'
import { type LabGame, type SpinEngine } from '../domain/types'
import { createSeededRandom, randomIntBetween } from '../rng'
import { type BetStrategy, type SessionResult, simulateSession } from './session'

/** §13.2: точная форма SimulationConfig из ТЗ + seed и игра. */
export interface SimulationConfig {
  numSessions: number
  avgSessionSpins: number
  depositRange: [number, number]
  betStrategy: BetStrategy
  maxReactivations: number
  /** §13.2: seed прогона; по умолчанию SIMULATION_DEFAULTS.seed. */
  seed: number
  gameId: string
}

/** Результат Monte Carlo: сессии по порядку, без параллельности (§13.1). */
export interface MonteCarloRun {
  config: SimulationConfig
  engineName: string
  /** Полный LabGame: нужен отчёту для аналитики лотереи. В JSON уходит срез (см. report.ts). */
  game: LabGame
  sessions: SessionResult[]
}

const SUB_SEED_MAX = 2_147_483_647
/**
 * Все сессии стартуют от одной и той же эпохи: лаборатория меряет длительность
 * сессии, а не календарь, и фиксированная точка входа держит детерминизм.
 */
const SIMULATION_EPOCH = new Date(0)

/** §13.2 DEFAULT_SIMULATION_CONFIG: числа берутся из SIMULATION_DEFAULTS. */
export function defaultSimulationConfig(
  overrides: Partial<SimulationConfig> = {},
): SimulationConfig {
  const base: SimulationConfig = {
    numSessions: SIMULATION_DEFAULTS.numSessions,
    avgSessionSpins: SIMULATION_DEFAULTS.avgSessionSpins,
    depositRange: [SIMULATION_DEFAULTS.depositMin, SIMULATION_DEFAULTS.depositMax],
    betStrategy: SIMULATION_DEFAULTS.betStrategy,
    maxReactivations: SIMULATION_DEFAULTS.maxReactivations,
    seed: SIMULATION_DEFAULTS.seed,
    gameId: 'fortunetiger',
  }
  return { ...base, ...overrides }
}

/**
 * Прогон numSessions сессий на одном seed (§13.1, §13.3).
 *
 * Детерминизм: один createSeededRandom(seed) раздаёт под-seed каждой сессии,
 * сессии идут последовательным циклом — никаких Promise.all и Math.random.
 * Порядок и количество random-вызовов внутри сессии не влияют на соседей,
 * поэтому одинаковый seed даёт идентичный набор сессий.
 *
 * avgSessionSpins трактуется как ЛИМИТ спинов сессии (§13.2 называет его
 * средним: разброс длин даёт не джиттер лимита, а остановки по балансу и по
 * терминальным фазам §5.1).
 */
export function runMonteCarlo(args: {
  engine: SpinEngine
  game: LabGame
  config: SimulationConfig
}): MonteCarloRun {
  const { engine, game, config } = args
  const masterRandom = createSeededRandom(config.seed)
  const sessions: SessionResult[] = []

  for (let sessionIndex = 0; sessionIndex < config.numSessions; sessionIndex++) {
    const sessionSeed = randomIntBetween(masterRandom, 1, SUB_SEED_MAX)
    const sessionRandom = createSeededRandom(sessionSeed)
    sessions.push(
      simulateSession({
        engine,
        game,
        params: {
          depositMin: config.depositRange[0],
          depositMax: config.depositRange[1],
          maxSpins: config.avgSessionSpins,
          betStrategy: config.betStrategy,
        },
        random: sessionRandom,
        userId: `player-${sessionIndex}`,
        sessionId: `session-${config.seed}-${sessionIndex}`,
        startedAt: SIMULATION_EPOCH,
      }),
    )
  }

  return {
    config,
    engineName: engine.name,
    game,
    sessions,
  }
}
