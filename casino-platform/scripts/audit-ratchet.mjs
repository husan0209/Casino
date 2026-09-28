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
import { readFileSync, writeFileSync } from 'node:fs'

const SEV = ['critical', 'high', 'moderate', 'low', 'info']
const BASELINE = 'tech-debt/pnpm-audit.txt'

const args = process.argv.slice(2)
const mode = args[0]
const reportPath = args[1]
if ((mode !== '--check' && mode !== '--gen') || !reportPath) {
  console.error('usage: audit-ratchet.mjs --check|--gen <audit.json>')
  process.exit(2)
}

const report = JSON.parse(readFileSync(reportPath, 'utf8'))
const cur = report.metadata?.vulnerabilities ?? {}

if (mode === '--gen') {
  writeFileSync(
    BASELINE,
    SEV.map((s) => `${s}\t${cur[s] ?? 0}`).join('\n') + '\n',
  )
  console.log(`baseline updated: ${BASELINE} (${JSON.stringify(cur)})`)
  process.exit(0)
}

const base = {}
for (const line of readFileSync(BASELINE, 'utf8').split('\n')) {
  const m = line.match(/^(critical|high|moderate|low|info)\t(\d+)\s*$/)
  if (m) base[m[1]] = Number(m[2])
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
    console.error(`❌ pnpm audit [${s}]: ${b} → ${c} — ВЫРОС. Триаж обязателен (см. docs/TECH_DEBT.md), затем осознанный --gen.`)
    fail = true
  } else if (c < b) {
    console.warn(`⚠️  pnpm audit [${s}]: ${b} → ${c} — базлайн можно ужать: node scripts/audit-ratchet.mjs --gen <audit.json>`)
  }
}
if (fail) process.exit(1)
console.log(`✅ pnpm audit ratchet OK: ${JSON.stringify(cur)}`)
