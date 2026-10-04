/**
 * Спеки на починенные гэты Tier 2 (2026-10-03): G7 (деньги кошелька) и
 * новый G24 (чужие записи Prisma) + G25 (анти-вакуумная самопроверка).
 *
 * Почему это вообще тестируется здесь: прежний G7 был «зелёным» два месяца,
 * ничего не проверяя (считал `$transaction` в файле, где их 0, и молча
 * пропускал отсутствующий файл). Unit-спека — второй слой: shell-детектор
 * живёт в `scripts/`, а эти тесты держат те же инварианты по исходникам и
 * гоняют сами детекторы, когда в системе есть `sh`.
 *
 * Разделение:
 *  - TS-проверки (ниже, без `sh`) — читают примитиву и карту владения;
 *  - прогон реальных детекторов через `sh` — CI и Git Bash; вне их он
 *    помечается предупреждением, а в CI отсутствие `sh` = красный прогон
 *    (гард не имеет права молча пропуститься).
 *
 * См. docs/QUALITY_GATES.md §3.2 (строки G7/G24/G25) и §3.6 (анти-вакуум).
 */
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const API_ROOT = process.cwd()
const PLATFORM_ROOT = join(API_ROOT, '..', '..')
const SRC = join(API_ROOT, 'src')
const LEDGER_DIR = join(SRC, 'modules/wallet/infrastructure/ledger')
const LOCK_FILE = join(LEDGER_DIR, 'wallet-transaction-lock.ts')
const LEDGER_FILE = join(LEDGER_DIR, 'wallet.ledger.prisma.ts')
const RUNNER_FILE = join(LEDGER_DIR, 'wallet-transaction-runner.prisma.ts')
const TECH_DEBT_SCRIPT = join(PLATFORM_ROOT, 'scripts', 'bin', 'tech-debt')
const WALLET_GUARD = join(PLATFORM_ROOT, 'scripts', 'check-wallet-money-invariant.sh')
const GUARD_SELFTEST = join(PLATFORM_ROOT, 'scripts', 'bin', 'guard-selftest')
const SCHEMA_FILE = join(PLATFORM_ROOT, 'packages', 'database', 'prisma', 'schema.prisma')
const FW_BASELINE = join(PLATFORM_ROOT, 'tech-debt', 'foreign-writes.txt')

/** Есть ли POSIX-оболочка (CI: ubuntu; локально: Git Bash). */
const HAS_SH = spawnSync('sh', ['-c', 'exit 0'], { encoding: 'utf8' }).status === 0
if (!HAS_SH) {
  // Молчаливый пропуск = ровно тот вакуум, из-за которого G7 не заметили.
  console.warn(
    '[architecture-guards] `sh` не найден — прогон shell-детекторов G7/G24/G25 пропущен. ' +
      'TS-проверки выше/ниже выполнены; в CI этот блок обязан отработать.',
  )
}

function read(path: string): string {
  return readFileSync(path, 'utf-8')
}

function tsFiles(dir: string, collected: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      tsFiles(full, collected)
    } else if (full.endsWith('.ts') && !full.endsWith('.spec.ts')) {
      collected.push(full)
    }
  }
  return collected
}

function countMatches(text: string, re: RegExp): number {
  return [...text.matchAll(re)].length
}

function tempTree(name: string): string {
  const root = join(tmpdir(), `casino-guards-${name}`)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  return root
}

function sh(file: string, args: string[], env: Record<string, string> = {}) {
  return spawnSync('sh', [file, ...args], {
    cwd: PLATFORM_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
}

describe('G7: деньги кошелька идут только через примитиву runWalletTransaction', () => {
  it('примитива существует в трёх файлах (нет файла — не «нечего проверять», а поломка)', () => {
    for (const file of [LOCK_FILE, LEDGER_FILE, RUNNER_FILE]) {
      expect(statSync(file).isFile(), `нет ${file}`).toBe(true)
    }
  })

  it('advisory-лок берётся РОВНО один раз и ДО вызова body(tx) (ADR GAP-57)', () => {
    const lock = read(LOCK_FILE)
    expect(countMatches(lock, /pg_advisory_xact_lock/g)).toBeGreaterThan(0)
    const callLine = lock.split('\n').findIndex((line) => /acquireWalletLock\(\s*tx\s*,/.test(line))
    const bodyLine = lock.split('\n').findIndex((line) => /body\(\s*tx\s*\)/.test(line))
    expect(callLine).toBeGreaterThan(-1)
    expect(bodyLine).toBeGreaterThan(-1)
    expect(callLine).toBeLessThan(bodyLine)
  })

  it('уровень изоляции — ровно один и ReadCommitted; Serializable возврата нет', () => {
    const lock = read(LOCK_FILE)
    expect(countMatches(lock, /isolationLevel/g)).toBe(1)
    expect(countMatches(lock, /isolationLevel\s*:\s*['"]ReadCommitted['"]/g)).toBe(1)
    expect(countMatches(lock, /isolationLevel\s*:\s*['"]Serializable['"]/g)).toBe(0)
  })

  it('повтор при конфликте объявлен и используется (MAX_ATTEMPTS >= 2)', () => {
    const lock = read(LOCK_FILE)
    const attempts = Number(/MAX_ATTEMPTS\s*=\s*(\d+)/.exec(lock)?.[1] ?? '0')
    expect(attempts).toBeGreaterThanOrEqual(2)
    expect(/attempt\s*<=\s*MAX_ATTEMPTS/.test(lock)).toBe(true)
    expect(countMatches(lock, /isRetryableConflict/g)).toBeGreaterThanOrEqual(2)
  })

  it('isolationLevel больше не встречается нигде в src, кроме примитивы', () => {
    const files = tsFiles(SRC).filter((f) => /isolationLevel/.test(read(f)))
    expect(files.map((f) => f.replace(/\\/g, '/'))).toEqual([
      LEDGER_DIR.replace(/\\/g, '/') + '/wallet-transaction-lock.ts',
    ])
  })

  it('ledger и runner зовут runWalletTransaction; леджер не открывает свою $transaction', () => {
    const ledger = read(LEDGER_FILE)
    const runner = read(RUNNER_FILE)
    expect(countMatches(ledger, /runWalletTransaction\s*\(/g)).toBeGreaterThan(0)
    expect(countMatches(runner, /runWalletTransaction\s*\(/g)).toBeGreaterThan(0)
    expect(countMatches(ledger, /prisma\s*\.\s*\$transaction\s*\(/g)).toBe(0)
  })

  it('кошелёк и леджер не пишутся через глобальный prisma-клиент, только через tx', () => {
    const ledger = read(LEDGER_FILE)
    expect(
      countMatches(
        ledger,
        /prisma\.(walletAccount|ledgerEntry)\s*\.\s*(create|update|delete|upsert)/g,
      ),
    ).toBe(0)
    expect(
      countMatches(ledger, /tx\.(walletAccount|ledgerEntry)\s*\.\s*(create|update)/g),
    ).toBeGreaterThan(0)
  })
})

describe('G24: foreign-writes — карта владения и базлайн', () => {
  const tool = read(TECH_DEBT_SCRIPT)
  const ownersBlock = /MODEL_OWNERS='([\s\S]*?)\n'/.exec(tool)?.[1] ?? ''
  const owners = ownersBlock
    .split(/\s+/)
    .filter((pair) => pair.includes(':'))
    .map((pair) => {
      const [model, mod] = pair.split(':')
      return { model: model as string, mod: mod as string }
    })
  const schemaModels = [...read(SCHEMA_FILE).matchAll(/^model\s+([A-Za-z0-9_]+)/gm)].map(
    (m) => m[1] as string,
  )

  it('карта владения непустая и в формате <Модель>:<модуль-владелец>', () => {
    expect(owners.length).toBeGreaterThan(10)
    for (const entry of owners) {
      expect(entry.model).toMatch(/^[A-Z][A-Za-z0-9]*$/)
      expect(existsSyncModule(entry.mod), `нет модуля ${entry.mod}`).toBe(true)
    }
  })

  it('карта покрывает ВСЕ модели схемы (и не ссылается на удалённые) — анти-вакуум', () => {
    const known = new Set(owners.map((o) => o.model))
    expect(schemaModels.length).toBeGreaterThan(20)
    expect(schemaModels.filter((m) => !known.has(m))).toEqual([])
    expect(owners.filter((o) => !schemaModels.includes(o.model)).map((o) => o.model)).toEqual([])
  })

  it('детектор пишет считает, чтения — нет (WRITE-регулярка правила)', () => {
    const writeRe = /WRITE = "\(([^"]+)\)"/.exec(tool)?.[1]
    expect(writeRe, 'нет регулярки методов записи в детекторе').toBeTruthy()
    expect((writeRe as string).split('|').sort()).toEqual([
      'create',
      'createMany',
      'delete',
      'deleteMany',
      'update',
      'updateMany',
      'upsert',
    ])
    for (const reader of ['find', 'count', 'aggregate', 'groupBy']) {
      expect(writeRe).not.toContain(reader)
    }
  })

  it('базлайн отформатирован (`путь<TAB>число`) и указывает на существующие файлы', () => {
    const rows = read(FW_BASELINE)
      .split('\n')
      .filter((line) => line.trim() !== '')
    for (const row of rows) {
      const cols = row.split('\t')
      expect(cols.length, `строка без таба: ${row}`).toBe(2)
      const [path, count] = cols as [string, string]
      expect(count).toMatch(/^[0-9]+$/)
      expect(path.startsWith('apps/api/src/modules/'), path).toBe(true)
      expect(existsSync(join(PLATFORM_ROOT, path)), `нет файла из базлайна: ${path}`).toBe(true)
    }
  })

  it('GAP-62: чужие записи affiliate в users в базлайне ровно когда они есть в коде', () => {
    const rel =
      'apps/api/src/modules/affiliate/infrastructure/player-provisioning.prisma.repository.ts'
    const source = read(join(PLATFORM_ROOT, rel))
    const writes = countMatches(source, /prisma\.user\s*\.\s*(create|delete|update|upsert)/g)
    const row = read(FW_BASELINE)
      .split('\n')
      .find((line) => line.startsWith(`${rel}\t`))
    if (writes === 0) {
      expect(row, 'GAP-62 погашен, а базлайн не ужмён').toBeUndefined()
      return
    }
    expect(Number((row ?? 'x\t0').split('\t')[1]), `GAP-62: ${writes} записей вне базлайна`).toBe(
      writes,
    )
  })
})

function existsSyncModule(mod: string): boolean {
  return statSync(join(SRC, 'modules', mod), { throwIfNoEntry: false })?.isDirectory() ?? false
}

describe('Прогон реальных гардов: зелёный на чистом дереве, красный на ловушке', () => {
  it.runIf(HAS_SH)('G7 зелёный на рабочем дереве', () => {
    const run = sh(WALLET_GUARD, [])
    expect(run.stdout).toContain('G7 OK')
    expect(run.status).toBe(0)
  })

  it.runIf(HAS_SH)('G7 краснеет: вырезан advisory-лок', () => {
    const tree = tempTree('g7-nolock')
    const dest = join(tree, 'apps/api/src/modules/wallet/infrastructure/ledger')
    mkdirSync(dest, { recursive: true })
    for (const file of [LOCK_FILE, LEDGER_FILE, RUNNER_FILE]) {
      writeFileSync(join(dest, file.split(/[\\/]/).pop() as string), read(file))
    }
    writeFileSync(
      join(dest, 'wallet-transaction-lock.ts'),
      read(join(dest, 'wallet-transaction-lock.ts')).replace(
        /pg_advisory_xact_lock/g,
        'none_advisory_lock',
      ),
    )
    const run = sh(WALLET_GUARD, [tree])
    expect(run.status).not.toBe(0)
    expect(`${run.stdout}${run.stderr}`).toContain('G7 FAIL')
    rmSync(tree, { recursive: true, force: true })
  })

  it.runIf(HAS_SH)('G7 краснеет: файл примитивы удалён (прежний гард тут молчал)', () => {
    const tree = tempTree('g7-nofile')
    const dest = join(tree, 'apps/api/src/modules/wallet/infrastructure/ledger')
    mkdirSync(dest, { recursive: true })
    writeFileSync(join(dest, 'wallet-transaction-lock.ts'), read(LOCK_FILE))
    writeFileSync(join(dest, 'wallet-transaction-runner.prisma.ts'), read(RUNNER_FILE))
    const run = sh(WALLET_GUARD, [tree])
    expect(run.status).not.toBe(0)
    expect(run.stdout).toContain('G7 FAIL')
    rmSync(tree, { recursive: true, force: true })
  })

  it.runIf(HAS_SH)('foreign-writes: ловушка «affiliate → prisma.user.update» поймана', () => {
    const tree = buildForeignTree('fw-trap')
    const run = sh(TECH_DEBT_SCRIPT, ['detect', 'foreign-writes'], { TECH_DEBT_ROOT: tree })
    // `detect` печатает найденный долг (красным его делает `check` ниже).
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('affiliate/infrastructure/foreign-write.trap.ts')
    // Поймана именно эта запись с количеством 1. Проверка построчная и терпит
    // любой порядок вывода и CR: `/…$/` без флага m привязывается к концу всего
    // stdout и ломался на Linux, где ловушка не последняя строка.
    const trapLine = run.stdout.split('\n').find((line) => line.includes('foreign-write.trap.ts'))
    expect(trapLine).toMatch(/foreign-write\.trap\.ts\t1\r?$/)
    rmSync(tree, { recursive: true, force: true })
  })

  it.runIf(HAS_SH)('foreign-writes: чтения чужих таблиц не считаются', () => {
    const tree = buildForeignTree('fw-readonly')
    writeFileSync(
      join(tree, 'apps/api/src/modules/affiliate/infrastructure/readonly.trap.ts'),
      [
        "import { prisma } from '@casino/database'",
        'export class ReadOnlyTrap {',
        '  run(userId: string) { return prisma.user.findMany({ where: { id: userId } }) }',
        '  kyc(userId: string) { return prisma.kycProfile.count({ where: { userId } }) }',
        '}',
        '',
      ].join('\n'),
    )
    const run = sh(TECH_DEBT_SCRIPT, ['detect', 'foreign-writes'], { TECH_DEBT_ROOT: tree })
    expect(run.status).toBe(0)
    expect(run.stdout).toBe('')
    rmSync(tree, { recursive: true, force: true })
  })

  it.runIf(HAS_SH)('foreign-writes: модель схемы без владельца в карте = exit 2', () => {
    const tree = buildForeignTree('fw-phantom')
    const schema = join(tree, 'packages/database/prisma/schema.prisma')
    writeFileSync(schema, `${read(schema)}\nmodel PhantomTable {\n  id String @id\n}\n`)
    const run = sh(TECH_DEBT_SCRIPT, ['detect', 'foreign-writes'], { TECH_DEBT_ROOT: tree })
    expect(run.status).toBe(2)
    expect(run.stderr).toContain('MODEL_OWNERS')
    rmSync(tree, { recursive: true, force: true })
  })

  it.runIf(HAS_SH)('G24 check зелёный на рабочем дереве и краснеет на ловушке', () => {
    const clean = sh(TECH_DEBT_SCRIPT, ['check', 'foreign-writes'])
    expect(clean.stdout).toContain('OK')
    expect(clean.status).toBe(0)
    const tree = buildForeignTree('fw-check')
    writeFileSync(join(tree, 'tech-debt/foreign-writes.txt'), read(FW_BASELINE))
    const dirty = sh(TECH_DEBT_SCRIPT, ['check', 'foreign-writes'], { TECH_DEBT_ROOT: tree })
    expect(dirty.status).toBe(1)
    expect(dirty.stdout).toContain('ВЫРОС')
    rmSync(tree, { recursive: true, force: true })
  })

  it.runIf(HAS_SH)(
    'G25 guard-selftest: все ловушки пойманы',
    () => {
      const run = sh(GUARD_SELFTEST, [])
      expect(`${run.stdout}\n${run.stderr}`).toContain('самопроверка пройдена')
      expect(run.status).toBe(0)
    },
    120_000,
  )
})

/**
 * Минимальное дерево под foreign-writes: схема + один «чужой» write.
 * `detect` базлайна не читает — ловушка ловится без копии всего репо.
 */
function buildForeignTree(name: string): string {
  const tree = tempTree(name)
  const modDir = join(tree, 'apps/api/src/modules/affiliate/infrastructure')
  mkdirSync(join(tree, 'packages/database/prisma'), { recursive: true })
  mkdirSync(join(tree, 'tech-debt'), { recursive: true })
  mkdirSync(modDir, { recursive: true })
  writeFileSync(schemaIn(tree), read(SCHEMA_FILE))
  if (name === 'fw-trap' || name === 'fw-check') {
    writeFileSync(
      join(modDir, 'foreign-write.trap.ts'),
      [
        "import { prisma } from '@casino/database'",
        'export class ForeignWriteTrap {',
        "  run(userId: string) { return prisma.user.update({ where: { id: userId }, data: { status: 'active' } }) }",
        '}',
        '',
      ].join('\n'),
    )
  }
  return tree
}

function schemaIn(tree: string): string {
  return join(tree, 'packages/database/prisma/schema.prisma')
}
