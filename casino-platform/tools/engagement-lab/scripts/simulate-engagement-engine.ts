/**
 * CLI симуляции §13.3: Monte Carlo по engagement-механикам и отчёт §13.5.
 *
 * Запуск (из casino-platform):
 *   pnpm tsx tools/engagement-lab/scripts/simulate-engagement-engine.ts \
 *     --sessions 10000 --spins 75 --deposit-min 500 --deposit-max 5000 \
 *     --engine baseline --seed 1 --output ./simulation-results.json
 *
 * Каталог лежит вне pnpm-workspace, своего node_modules у него нет, а tsx
 * подхватывает tsconfig.json (с его paths) только по флагу --tsconfig. Чтобы
 * команда из §13.3 работала ровно как написана, алиасы workspace-пакетов —
 * те же, что в vitest.config.ts — регистрируются до загрузки лабораторных
 * модулей. Отсюда динамические import(): статический импорт отработался бы
 * раньше, чем алиасы попадут в резолвер.
 */
import fs from 'node:fs'
import Module from 'node:module'
import path from 'node:path'

import type { SpinEngine } from '../src/domain/types'
import type { EngagementMetricsResult } from '../src/metrics/engagement-metrics'
import type { SimulationReport } from '../src/sim/report'

const LAB_ROOT = path.resolve(__dirname, '..')
const WORKSPACE_ROOT = path.resolve(LAB_ROOT, '..', '..')
const WORKSPACE_PACKAGE_ALIASES: Record<string, string> = {
  '@casino/shared-utils': path.join(WORKSPACE_ROOT, 'packages', 'shared-utils', 'src', 'index.ts'),
  '@casino/shared-types': path.join(WORKSPACE_ROOT, 'packages', 'shared-types', 'src', 'index.ts'),
}

type ResolveFilename = (
  request: string,
  parent: unknown,
  isMain: boolean,
  options?: unknown,
) => string

const defaultResolveFilename = Module._resolveFilename as unknown as ResolveFilename
Module._resolveFilename = ((...resolveArgs: Parameters<ResolveFilename>): string => {
  const [request, parent, isMain, options] = resolveArgs
  const alias = WORKSPACE_PACKAGE_ALIASES[request]
  if (alias) {
    return alias
  }
  return defaultResolveFilename(request, parent, isMain, options)
}) as unknown as typeof Module._resolveFilename

const ENGINE_NAMES = ['baseline', 'engagement'] as const
const BET_STRATEGIES = ['fixed', 'random', 'martingale'] as const

interface CliArgs {
  sessions: number
  spins: number
  depositMin: number
  depositMax: number
  engine: 'baseline' | 'engagement'
  seed: number
  output: string
  game: string
  strategy: 'fixed' | 'random' | 'martingale'
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
  throw new Error(message)
}

function parseFlags(argv: readonly string[]): Record<string, string> {
  const flags: Record<string, string> = {}
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index] as string
    if (!token.startsWith('--')) {
      fail(`Неизвестный аргумент: "${token}". Формат: --<имя> <значение>.`)
    }
    const name = token.slice(2)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) {
      fail(`У флага --${name} нет значения.`)
    }
    flags[name] = value
    index++
  }
  return flags
}

function numberFlag(flags: Record<string, string>, name: string, fallback: number): number {
  const raw = flags[name]
  if (raw === undefined) {
    return fallback
  }
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) {
    fail(`--${name} должно быть числом, получено "${raw}".`)
  }
  return parsed
}

/** Обязательный целочисленный флаг >= 1 (sessions/spins §13.3). */
function integerFlag(flags: Record<string, string>, name: string, value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    fail(`--${name} должно быть целым числом >= 1, получено "${String(flags[name])}".`)
  }
  return value
}

function engineFlag(flags: Record<string, string>): CliArgs['engine'] {
  const engine = flags['engine'] ?? 'baseline'
  if (!(ENGINE_NAMES as readonly string[]).includes(engine)) {
    fail(`--engine принимает только ${ENGINE_NAMES.join(' | ')}, получено "${engine}".`)
  }
  return engine as CliArgs['engine']
}

function strategyFlag(flags: Record<string, string>, fallback: string): CliArgs['strategy'] {
  const strategy = flags['strategy'] ?? fallback
  if (!(BET_STRATEGIES as readonly string[]).includes(strategy)) {
    fail(`--strategy принимает ${BET_STRATEGIES.join(' | ')}, получено "${strategy}".`)
  }
  return strategy as CliArgs['strategy']
}

/** §13.3: разбор аргументов; дефолты — SIMULATION_DEFAULTS (§13.2). */
async function parseArgs(): Promise<CliArgs> {
  const { SIMULATION_DEFAULTS } = await import('../src/config')
  const flags = parseFlags(process.argv.slice(2))

  const sessions = integerFlag(
    flags,
    'sessions',
    numberFlag(flags, 'sessions', SIMULATION_DEFAULTS.numSessions),
  )
  const spins = integerFlag(
    flags,
    'spins',
    numberFlag(flags, 'spins', SIMULATION_DEFAULTS.avgSessionSpins),
  )
  const depositMin = numberFlag(flags, 'deposit-min', SIMULATION_DEFAULTS.depositMin)
  const depositMax = numberFlag(flags, 'deposit-max', SIMULATION_DEFAULTS.depositMax)
  const seed = numberFlag(flags, 'seed', SIMULATION_DEFAULTS.seed)

  if (depositMin < 1 || depositMax < depositMin) {
    fail(
      `Диапазон депозитов некорректен: --deposit-min ${depositMin}, --deposit-max ${depositMax}.`,
    )
  }

  return {
    sessions,
    spins,
    depositMin,
    depositMax,
    engine: engineFlag(flags),
    seed,
    output: flags['output'] ?? './simulation-results.json',
    game: flags['game'] ?? 'fortunetiger',
    strategy: strategyFlag(flags, SIMULATION_DEFAULTS.betStrategy),
  }
}

/**
 * Плечо engagement (§9.1, §10.1) пишет другой агент параллельно, и файла может
 * ещё не быть: импорт динамический, при неудаче — внятное сообщение вместо
 * «Cannot find module». baseline обязан работать всегда.
 */
async function resolveEngine(name: CliArgs['engine']): Promise<SpinEngine> {
  if (name === 'baseline') {
    const { createBaselineEngine } = await import('../src/engine/baseline-engine')
    return createBaselineEngine()
  }

  const engineModulePath = path.join(LAB_ROOT, 'src', 'engine', 'engagement-engine.ts')
  if (!fs.existsSync(engineModulePath)) {
    fail(
      `Движок engagement недоступен: файла нет — ${engineModulePath}. Его реализует задача §9.1/§10.1; ` +
        'пока его нет, запускайте --engine baseline.',
    )
  }

  let loaded: Record<string, unknown>
  try {
    loaded = (await import('../src/engine/engagement-engine')) as Record<string, unknown>
  } catch (error) {
    fail(
      `Движок engagement не загрузился из ${engineModulePath}: ${String(error)}. ` +
        'Модуль, вероятно, ещё в работе — запускайте --engine baseline.',
    )
  }

  const candidateNames = [
    'createEngagementEngine',
    'createEngagementSpinEngine',
    'engagementEngine',
  ]
  const found = candidateNames
    .map((candidateName) => loaded[candidateName])
    .find((candidate) => {
      if (typeof candidate === 'function') {
        return true
      }
      return typeof candidate === 'object' && candidate !== null && 'spin' in candidate
    })

  const engine = typeof found === 'function' ? (found as () => unknown)() : (found as unknown)
  if (!engine || typeof (engine as { spin?: unknown }).spin !== 'function') {
    fail(
      `В ${engineModulePath} не найден SpinEngine — ожидали экспорт ${candidateNames.join(', ')}. ` +
        'Модуль, вероятно, ещё в работе — запускайте --engine baseline.',
    )
  }
  return engine as SpinEngine
}

const VERDICT_COLUMN_WIDTHS = { metric: 30, value: 14, target: 40, verdict: 15 }

/** Ячейки строки таблицы вердиктов §13.4. */
interface VerdictCells {
  metric: string
  value: string
  target: string
  verdict: string
}

function verdictRow(cells: VerdictCells): string {
  return [
    cells.metric.padEnd(VERDICT_COLUMN_WIDTHS.metric),
    cells.value.padEnd(VERDICT_COLUMN_WIDTHS.value),
    cells.target.padEnd(VERDICT_COLUMN_WIDTHS.target),
    cells.verdict.padEnd(VERDICT_COLUMN_WIDTHS.verdict),
  ].join(' ')
}

function verdictTable(report: SimulationReport): string {
  const lines = report.verdicts.map((row) =>
    verdictRow({
      metric: row.metric,
      value: row.value === null ? '—' : String(row.value),
      target: row.target,
      verdict: row.verdict,
    }),
  )
  const dashes = (width: number): string => '-'.repeat(width)
  return [
    verdictRow({ metric: 'Метрика', value: 'Значение', target: 'Цель §13.4', verdict: 'Вердикт' }),
    verdictRow({
      metric: dashes(VERDICT_COLUMN_WIDTHS.metric),
      value: dashes(VERDICT_COLUMN_WIDTHS.value),
      target: dashes(VERDICT_COLUMN_WIDTHS.target),
      verdict: dashes(VERDICT_COLUMN_WIDTHS.verdict),
    }),
    ...lines,
  ].join('\n')
}

/** Печать отчёта §13.5 в stdout (JSON уже сохранён на диск). */
function printReport(args: {
  report: SimulationReport
  metrics: EngagementMetricsResult
  outputPath: string
  elapsedMs: number
}): void {
  const { report, metrics, outputPath, elapsedMs } = args
  process.stdout.write(`${verdictTable(report)}\n\n`)
  process.stdout.write(
    `Итог: passed=${String(report.passed)} PASS=${report.counts.pass} WARN=${report.counts.warn} ` +
      `FAIL=${report.counts.fail} NOT_MEASURABLE=${report.counts.notMeasurable} ` +
      `(${elapsedMs} мс, ${report.summary.totalSpins} спинов)\n`,
  )
  process.stdout.write(
    `Сводка §13.5: cumulativeRtp=${report.summary.cumulativeRtp} % ` +
      `(σ спина ${report.summary.rtpStdDevPerSpin} п.п., σ сессий ${report.summary.rtpStdDev} п.п.), ` +
      `avgSessionDuration=${report.summary.avgSessionDuration}, ` +
      `onboardingSuccessRate=${report.summary.onboardingSuccessRate}, ` +
      `avgReactivationsPerSession=${report.summary.avgReactivationsPerSession}, ` +
      `ldwFrequency=${report.summary.ldwFrequency}, nearMissFrequency=${report.summary.nearMissFrequency}, ` +
      `drift=${report.summary.driftCompensationEffectiveness} п.п.\n`,
  )
  process.stdout.write(
    `Балансы: p50=${report.distribution.finalBalance.formatted.p50}, ` +
      `p90=${report.distribution.finalBalance.formatted.p90}, ` +
      `p99=${report.distribution.finalBalance.formatted.p99}; ` +
      `длительность: p50=${report.distribution.sessionDuration.formatted.p50}, ` +
      `p90=${report.distribution.sessionDuration.formatted.p90}, ` +
      `p99=${report.distribution.sessionDuration.formatted.p99}\n`,
  )
  process.stdout.write(
    `Остановки сессий: ${Object.entries(report.stopReasons)
      .map(([reason, count]) => `${reason}=${String(count)}`)
      .join(', ')}\n`,
  )
  const alertedMetrics = metrics.alerts
    .filter((metric) => metric.alert)
    .map((metric) => metric.name)
  process.stdout.write(
    `Алерты §11.1: ${alertedMetrics.length === 0 ? 'нет' : alertedMetrics.join(', ')}\n`,
  )
  process.stdout.write(`Отчёт: ${outputPath}\n\nПримечания:\n`)
  report.notes.forEach((note, index) => {
    process.stdout.write(`${index + 1}. ${note}\n`)
  })
}

async function main(): Promise<void> {
  const args = await parseArgs()
  const { findLabGame } = await import('../src/game-data')
  const { defaultSimulationConfig, runMonteCarlo } = await import('../src/sim/monte-carlo')
  const { buildSimulationReport } = await import('../src/sim/report')
  const { computeEngagementMetrics } = await import('../src/metrics/engagement-metrics')

  const game = findLabGame(args.game)
  const engine = await resolveEngine(args.engine)
  const config = defaultSimulationConfig({
    numSessions: args.sessions,
    avgSessionSpins: args.spins,
    depositRange: [args.depositMin, args.depositMax],
    betStrategy: args.strategy,
    seed: args.seed,
    gameId: game.externalGameId,
  })

  process.stdout.write(
    `Прогон: engine=${engine.name} game=${game.externalGameId}@${game.baseRtp}% ` +
      `sessions=${config.numSessions} spinsLimit=${config.avgSessionSpins} ` +
      `deposits=${config.depositRange[0]}..${config.depositRange[1]} strategy=${config.betStrategy} seed=${config.seed}\n`,
  )

  const startedAtMs = Date.now()
  const run = runMonteCarlo({ engine, game, config })
  const metrics = computeEngagementMetrics(run.sessions)
  const report = buildSimulationReport({ run, metrics })
  const elapsedMs = Date.now() - startedAtMs

  const outputPath = path.resolve(process.cwd(), args.output)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  printReport({ report, metrics, outputPath, elapsedMs })
}

void main().catch((error: unknown) => {
  if (!process.exitCode) {
    process.stderr.write(`Прогон упал: ${String(error)}\n`)
    process.exitCode = 1
  }
})
