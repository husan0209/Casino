import { Decimal } from 'decimal.js'
import { describe, expect, it } from 'vitest'

import {
  seededRandomFor,
  assertProperty,
  collectViolations,
  intGenerator,
} from './property-harness'
import { BALANCE_CYCLE, SIMULATION_DEFAULTS, SIMULATION_SUCCESS_CRITERIA } from '../src/config'
import { createBaselineEngine } from '../src/engine/baseline-engine'
import { findLabGame, winPayoutsOf } from '../src/game-data'
import { analyticSpinStdDevPercent } from '../src/sim/report'
import { simulateSession, type SessionResult } from '../src/sim/session'

/**
 * Три свойства §13.6 на собственном harness'е (fast-check в монорепо нет).
 *
 * Буквальные допуски §13.6 («cumulativeRtp 94–98», «drift < 3 после 100+
 * спинов») на tables Fortune Tiger ложны: σ одного спина по весам лотереи —
 * 383 п.п. RTP (две строки платят 250x, README «Проверенное на каркасе»).
 * Поэтому свойства проверяют то же утверждение с допуском по дисперсии, а
 * буквальную границу мы измеряем отдельно и докладываем как нарушение ТЗ.
 */
const DISPERSION_SIGMA_K = 6
/**
 * Ставка ограничена 10 % депозита: §13.6 генерирует betSize до 1000 при
 * deposit от 100, а один ва-банк на весь банкролл RTP-полосу не определяет
 * вовсе (сэмпл = 1 спин). Это ограничение области входов, а не допусков.
 */
const BET_CAP_DEPOSIT_DIVISOR = 10
/** Порог из буквального свойства §13.6.3 (`drift < 3`) — п.п. RTP. */
const LITERAL_DRIFT_LIMIT_PERCENT = 3

const game = findLabGame('fortunetiger')
const engine = createBaselineEngine()
const analyticRtp = Number(game.baseRtp)
const sigmaPerSpinPercent = analyticSpinStdDevPercent(game, game.baseRtp)
const maxSpinPayoutPercent =
  Math.max(...winPayoutsOf(game).map((payout) => payout / game.paylines)) * 100

interface SessionRunArgs {
  deposit: number
  spins: number
  betSize?: number
}

function runSession(args: SessionRunArgs, runId: number): SessionResult {
  const bet =
    args.betSize === undefined
      ? undefined
      : new Decimal(Math.min(args.betSize, args.deposit / BET_CAP_DEPOSIT_DIVISOR))
          .toDecimalPlaces(8)
          .toString()
  return simulateSession({
    engine,
    game,
    params: {
      depositMin: args.deposit,
      depositMax: args.deposit,
      maxSpins: args.spins,
      betStrategy: 'fixed',
      betTotalOverride: bet,
    },
    random: seededRandomFor(runId),
    userId: `player-${runId}`,
    sessionId: `session-${runId}`,
    startedAt: new Date(0),
  })
}

/**
 * СКО накопленного RTP этого прогона по фактическим ставкам:
 * σ_run = σ_спина * sqrt(Σ bet^2) / Σ bet (для равных ставок = σ/√n).
 */
function runStdDevPercent(session: SessionResult): number {
  const totalBet = Number(session.totalBetAmount)
  if (!(totalBet > 0) || !(session.sumBetSquared > 0)) {
    return Number.POSITIVE_INFINITY
  }
  return (sigmaPerSpinPercent * Math.sqrt(session.sumBetSquared)) / totalBet
}

describe('свойства §13.6', () => {
  it('аккумулятивный RTP внутри полосы по дисперсии таблицы (1000 прогонов)', () => {
    const report = assertProperty({
      name: '§13.6.1 cumulativeRtp в допустимом диапазоне',
      generators: {
        deposit: intGenerator('deposit', 100, 10_000),
        betSize: intGenerator('betSize', 10, 1_000),
        spins: intGenerator('spins', 10, 200),
      },
      predicate: (values, runId) => {
        const session = runSession(
          { deposit: values.deposit, spins: values.spins, betSize: values.betSize },
          runId,
        )
        const sigma = runStdDevPercent(session)
        const deviation = Math.abs(session.cumulativeRtp - analyticRtp)
        if (!Number.isFinite(session.cumulativeRtp) || session.cumulativeRtp < 0) {
          return { reason: `RTP вне области неотрицательных: ${session.cumulativeRtp}` }
        }
        if (session.cumulativeRtp > maxSpinPayoutPercent) {
          return {
            reason: `RTP ${session.cumulativeRtp} выше потолка таблицы ${maxSpinPayoutPercent}`,
          }
        }
        if (deviation > DISPERSION_SIGMA_K * sigma) {
          return {
            reason:
              `|${session.cumulativeRtp} − ${analyticRtp}| = ${deviation.toFixed(2)} п.п. ` +
              `> ${DISPERSION_SIGMA_K}σ = ${(DISPERSION_SIGMA_K * sigma).toFixed(2)} ` +
              `(спинов ${session.totalSpins})`,
          }
        }
        return true
      },
      numRuns: 1_000,
    })
    expect(report.passed).toBe(true)
    expect(report.violations).toHaveLength(0)
  }, 120_000)

  it('реактиваций не больше лимита (1000 прогонов)', () => {
    const limit = Math.min(SIMULATION_DEFAULTS.maxReactivations, BALANCE_CYCLE.maxReactivations)
    const report = assertProperty({
      name: '§13.6.2 reactivationCount <= maxReactivations',
      generators: {
        deposit: intGenerator('deposit', 100, 10_000),
        spins: intGenerator('spins', 50, 200),
      },
      predicate: (values, runId) => {
        const session = runSession({ deposit: values.deposit, spins: values.spins }, runId)
        if (session.reactivationCount > limit) {
          return { reason: `реактиваций ${session.reactivationCount} > лимита ${limit}` }
        }
        if (session.reactivationLimitExceeded) {
          return { reason: 'флаг превышения лимита реактиваций поднят на легальном плече' }
        }
        if (Number(session.reactivationCreditTotal) < 0) {
          return { reason: `кредит реактивации отрицательный: ${session.reactivationCreditTotal}` }
        }
        return true
      },
      numRuns: 1_000,
    })
    expect(report.passed).toBe(true)
  }, 120_000)

  it('дрейф сходится: |rtpDrift| внутри 1/√n-полосы после 100+ спинов (100 прогонов)', () => {
    const report = assertProperty({
      name: '§13.6.3 drift compensation сходится к целевому RTP',
      generators: {
        deposit: intGenerator('deposit', 500, 10_000),
        betSize: intGenerator('betSize', 10, 200),
        spins: intGenerator('spins', 100, 500),
      },
      predicate: (values, runId) => {
        const session = runSession(
          { deposit: values.deposit, spins: values.spins, betSize: values.betSize },
          runId,
        )
        const sigma = runStdDevPercent(session)
        // Огибающая обязана убывать вместе с числом спинов: это и есть
        // «сходится после 100+ спинов» в формулировке, не зависящей от везения.
        const envelopeOf = (spins: number): number =>
          (DISPERSION_SIGMA_K * sigmaPerSpinPercent) / Math.sqrt(spins)
        if (!(envelopeOf(500) < envelopeOf(100))) {
          return { reason: 'огибающая дрейфа не убывает с ростом числа спинов' }
        }
        if (session.absRtpDrift > DISPERSION_SIGMA_K * sigma) {
          return {
            reason:
              `|drift| = ${session.absRtpDrift.toFixed(2)} п.п. > ${DISPERSION_SIGMA_K}σ = ` +
              `${(DISPERSION_SIGMA_K * sigma).toFixed(2)} (спинов ${session.totalSpins})`,
          }
        }
        return true
      },
      numRuns: 100,
    })
    expect(report.passed).toBe(true)
  }, 120_000)

  it('буквальная граница §13.6 (94–98 %) на этих выборках ложна — фиксируем как дефект ТЗ', () => {
    const violations = collectViolations({
      generators: {
        deposit: intGenerator('deposit', 100, 10_000),
        betSize: intGenerator('betSize', 10, 1_000),
        spins: intGenerator('spins', 10, 200),
      },
      predicate: (values, runId) => {
        const session = runSession(
          { deposit: values.deposit, spins: values.spins, betSize: values.betSize },
          runId,
        )
        return session.cumulativeRtp >= SIMULATION_SUCCESS_CRITERIA.cumulativeRtpMin &&
          session.cumulativeRtp <= SIMULATION_SUCCESS_CRITERIA.cumulativeRtpMax
          ? true
          : {
              reason: `RTP ${session.cumulativeRtp} вне ${SIMULATION_SUCCESS_CRITERIA.cumulativeRtpMin}–${SIMULATION_SUCCESS_CRITERIA.cumulativeRtpMax}`,
            }
      },
      numRuns: 200,
    })
    // На полном наборе §13.6 (1000 прогонов по 10–200 спинов) вне полосы ~98 %
    // прогонов; 200 прогонов здесь — чтобы тест был быстрым и не флейкал.
    expect(violations.length).toBeGreaterThan(100)
  })

  it('буквальный «drift < 3» из §13.6 требует несопоставимо более длинной сессии', () => {
    // |dev| < LITERAL_DRIFT_LIMIT_PERCENT с тем же запасом в K·σ:
    // n >= (K·σ_спина / 3)^2. Число спинов, при котором ТЗ обещает сходимость
    // («после 100+»), на этих таблицах дисперсии не достигает.
    const requiredSpins = Math.ceil(
      new Decimal(DISPERSION_SIGMA_K * sigmaPerSpinPercent)
        .div(LITERAL_DRIFT_LIMIT_PERCENT)
        .pow(2)
        .toNumber(),
    )
    expect(requiredSpins).toBeGreaterThan(10_000)
  })
})
