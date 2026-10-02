#!/usr/bin/env node
// Храповик pnpm audit (тот же принцип, что scripts/bin/tech-debt):
// существующие уязвимости заморожены в tech-debt/pnpm-audit.txt, FAIL —
// только если какой-то severity ВЫРОС (новый CVE в дереве или апгрейд
// принёс хуже). Регистри БД живёт своей жизнью: новый CVE краснит job —
// это осознанно, триаж обязателен (upgrade / pnpm.auditOverrides / mute),
// после чего базлайн ужмётся через --gen.
//
//   node scripts/audit-ratchet.mjs --check <audit.json>   — сверить с базлайном (CI)
//   node scripts/audit-ratchet.mjs --gen <audit.json>     — перезаписать базлайн
//
// <audit.json> — вывод `pnpm audit --prod --json` (exit code audit не важен,
// отчёт валиден и при найденных уязвимостях).
//
// ПОЧЕМУ НЕ report.metadata.vulnerabilities (исторический баг храповика):
// pnpm применяет pnpm.auditConfig.ignoreGhsas только к auditReport.advisories,
// а metadata.vulnerabilities пересылает с реестра как есть (проверено на
// pnpm 9.12 и 11.7 из кэша corepack: filter по github_advisory_id сидит в
// выводе, счётчики — нет). Значит заглушка риска в metadata не видна НИКОГДА,
// и храповик, читающий metadata, сравнивал с базлайном цифры ДО заглушки:
// 3 critical в tech-debt/pnpm-audit.txt жили там независимо от того, что все
// три critical стояли в ignoreGhsas. Считаем от advisories — из того же
// источника, который реально фильтруется. Mute-лист перечитывается из
// package.json и применяется повторно: идемпотентно, если pnpm уже
// отфильтровал отчёт, и честно, если в CI pnpm фильтровать не стал.
//
// Mute-лист = реестр принятого риска и он же единственная заглушка: базлайн
// обязан отражать НЕ заглушённый остаток, иначе гейт «не заморожен, а
// слеп». Просроченные GHSA (уже не встречаются в отчёте) нужно вычищать —
// иначе они молча заглушат регрессию той же CVE в будущем.
import { readFileSync, writeFileSync } from 'node:fs'

const SEV = ['critical', 'high', 'moderate', 'low', 'info']
const BASELINE = 'tech-debt/pnpm-audit.txt'
const MANIFEST = 'package.json'
// Реестр может посчитать одну advisory дважды (GHSA на две версии пакета),
// поэтому metadata обычно на 1 больше, чем advisories (наблюдено: 29 vs 28 и
// 52 vs 51). Допуск = METADATA_SLACK: больше — это уже не двойной счёт, а
// потерянные записи.
const METADATA_SLACK = 2

const args = process.argv.slice(2)
const mode = args[0]
const reportPath = args[1]
if ((mode !== '--check' && mode !== '--gen') || !reportPath) {
  console.error('usage: audit-ratchet.mjs --check|--gen <audit.json>')
  process.exit(2)
}

const report = JSON.parse(readFileSync(reportPath, 'utf8'))
const meta = report.metadata?.vulnerabilities ?? {}
const advisories = report.advisories
if (!advisories || typeof advisories !== 'object') {
  console.error('❌ в отчёте нет поля `advisories` — это не `pnpm audit --prod --json` (v1)?')
  process.exit(2)
}

// pnpm.auditConfig.ignoreGhsas — читаем из манифеста, а не доверяем тому,
// что pnpm уже отфильтровал: отчёт мог прийти из другой версии pnpm.
let ignore = []
try {
  ignore = JSON.parse(readFileSync(MANIFEST, 'utf8'))?.pnpm?.auditConfig?.ignoreGhsas ?? []
} catch {
  console.warn(`⚠️  ${MANIFEST}: pnpm.auditConfig.ignoreGhsas не прочитан — считаю без mute-листа`)
}
const ignored = new Set(ignore)

const counted = Object.values(advisories).filter(
  ({ github_advisory_id: ghsa }) => !(ghsa && ignored.has(ghsa)),
)
const mutedInReport = Object.values(advisories).length - counted.length

const cur = Object.fromEntries(SEV.map((s) => [s, 0]))
for (const { severity } of counted) {
  if (cur[severity] === undefined) {
    console.error(`❌ незнакомый severity «${severity}» в отчёте — обновить SEV в скрипте`)
    process.exit(2)
  }
  cur[severity] += 1
}

const total = (o) => SEV.reduce((n, s) => n + (o[s] ?? 0), 0)
const metaTotal = total(meta)
const visibleTotal = total(cur)
// Канарейка «отчёт неполон». metadata реестр считает ДО заглушки, а pnpm
// отдаёт advisories уже фильтрованным, поэтому разрыв metadata vs видимый
// долг объясняется только объёмом mute-листа (+ сколько снял я) и двойным
// счётом реестра. Разрыв больше — значит отчёт потерял записи (другое дерево,
// оборванный ответ endpoint'а): базлайн по нему строить нельзя, иначе долг
// занижается и гейт превращается в видимость контроля.
if (!metaTotal) {
  console.warn('⚠️  в отчёте нет metadata.vulnerabilities — сверку полноты отчёта не сделать')
}
if (metaTotal - visibleTotal > ignore.length + mutedInReport + METADATA_SLACK) {
  console.error(
    `❌ отчёт неполон: metadata=${metaTotal}, осталось после mute=${visibleTotal} ` +
      `(в отчёте advisories=${Object.values(advisories).length}, снято мной=${mutedInReport}, ` +
      `mute-лист=${ignore.length}, допуск на двойной счёт=${METADATA_SLACK}). ` +
      'Разрыв не объясняется заглушкой: отчёт оборван или снят с другого дерева. ' +
      'Базлайн по нему не пишется — перегенери целиком (pnpm audit --prod --json > audit.json).',
  )
  process.exit(2)
}

const detail = `видимый долг ${JSON.stringify(cur)} (advisories в отчёте=${
  Object.values(advisories).length
}, снято mute-листом здесь=${mutedInReport}, всего по metadata без mute=${metaTotal})`

if (mode === '--gen') {
  const lines = SEV.map((s) => `${s}\t${cur[s] ?? 0}`).join('\n') + '\n'
  writeFileSync(BASELINE, lines)
  process.stdout.write(`baseline updated: ${BASELINE} (${detail})\n`)
  process.exit(0)
}

const base = {}
for (const line of readFileSync(BASELINE, 'utf8').split('\n')) {
  const m = line.match(/^(critical|high|moderate|low|info)\t(\d+)\s*$/)
  if (m) {
    base[m[1]] = Number(m[2])
  }
}
if (SEV.every((s) => base[s] === undefined)) {
  console.error(`❌ базлайн ${BASELINE} пуст или не читается`)
  process.exit(2)
}

let fail = false
for (const s of SEV) {
  const c = cur[s] ?? 0
  const b = base[s] ?? 0
  if (c > b) {
    console.error(
      `❌ pnpm audit [${s}]: ${b} → ${c} — ВЫРОС. Триаж обязателен (см. docs/TECH_DEBT.md), затем осознанный --gen.`,
    )
    fail = true
  } else if (c < b) {
    console.warn(
      `⚠️  pnpm audit [${s}]: ${b} → ${c} — базлайн можно ужать: node scripts/audit-ratchet.mjs --gen <audit.json>`,
    )
  }
}
if (fail) {
  process.exit(1)
}
process.stdout.write(`✅ pnpm audit ratchet OK: ${detail}\n`)
