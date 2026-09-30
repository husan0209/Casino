// G22: каждый внедряемый параметр конструктора Nest-провайдера обязан нести @Inject(Token).
//
// Зачем: packages/tsconfig/nest.json держит emitDecoratorMetadata:false (нативный компилятор
// tsgo метаданные не эмитит), поэтому Nest не может вывести зависимость по типу параметра.
// Такой конструктор собирается, проходит tsc и ESLint, приложение стартует — и падает в
// первом же обращении:
//   TypeError: Cannot read properties of undefined (reading 'execute')
// ni tsc, ни ESLint его не бракуют, поэтому проверка статическая (реестр — docs/QUALITY_GATES.md §3.2).
//
// Правило и примеры: docs/ARCHITECTURE.md §5.3, docs/AI_DEVELOPMENT_RULES.md §3.2.
//
//   node scripts/check-explicit-di.mjs [каталог...]   (по умолчанию apps/api/src)
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const roots = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['apps/api/src']

/** Классы, чьи конструкторы собирает Nest. */
const PROVIDER_RE = [
  /^@Injectable\b/gm,
  /^@Controller\b/gm,
  /^@Catch\b/gm,
  /^@Gateway\b/gm,
  /^@Interceptor\b/gm,
  /^@Pipe\b/gm,
]

/** Явные формы внедрения: @Inject и его специализированные варианты. */
const EXPLICIT = ['@Inject', '@InjectQueue', '@InjectRedis', '@Optional', '@Self', '@SkipSelf']
const OPEN = '([{'
const CLOSE = ')]}'

function isProviderBlock(block) {
  return PROVIDER_RE.some((re) => {
    re.lastIndex = 0
    return re.test(block)
  })
}

function collectTsFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name !== 'node_modules' && name !== 'dist') {
        collectTsFiles(p, acc)
      }
    } else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) {
      acc.push(p)
    }
  }
  return acc
}

/** Вырез содержимого круглых скобок, открытых в позиции open. */
function matchParens(src, open) {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') {
      depth++
    } else if (src[i] === ')') {
      depth--
      if (depth === 0) {
        return src.slice(open + 1, i)
      }
    }
  }
  return ''
}

/**
 * Текст между предыдущей верхнеуровневой декларацией и началом класса — то есть блок
 * декораторов этого класса. Многострочные вызовы (@Throttle({ ... })) попадают сюда целиком.
 * Ищем объявление строго с начала строки: иначе `'class'` внутри декоратора-строки
 * (@Controller('admin/classes')) обрезал бы блок и класс потерял бы свой провайдер-декоратор.
 */
function decoratorBlock(src, classStart) {
  const before = src.slice(0, classStart)
  let cut = -1
  for (const m of before.matchAll(
    /^(?:export\s+)?(?:abstract\s+)?(?:class|interface|function|enum|type|const)\b/gm,
  )) {
    cut = m.index
  }
  return cut > 0 ? before.slice(cut) : before
}

/** Параметры конструктора верхнего уровня (вложенные <>/()/{} не режем по запятой). */
function splitParams(block) {
  const out = []
  let depth = 0
  let cur = ''
  for (const ch of block) {
    if (OPEN.includes(ch) || ch === '<') {
      depth++
    } else if (CLOSE.includes(ch) || ch === '>') {
      depth--
    }
    if (ch === ',' && depth === 0) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  if (cur.trim() !== '') {
    out.push(cur)
  }
  return out
}

function constructorParams(src, bodyStart) {
  const ctorIdx = src.indexOf('constructor', bodyStart)
  if (ctorIdx < 0) {
    return { params: '', line: 0 }
  }
  const openParen = src.indexOf('(', ctorIdx)
  const params = matchParens(src, openParen)
  return { params, line: src.slice(0, ctorIdx).split('\n').length }
}

/** Неявные параметры одного класса-провайдера. */
function implicitParams(file, cls, ctor) {
  const hits = []
  for (const raw of splitParams(ctor.params)) {
    const p = raw.trim().replace(/\s+/g, ' ')
    const isInjected = /(private|public|protected|readonly)/.test(p)
    const explicit = EXPLICIT.some((e) => p.includes(e))
    if (isInjected && !explicit) {
      hits.push(`${file}:${ctor.line} ${cls} :: ${p.slice(0, 90)}`)
    }
  }
  return hits
}

function scanClass(src, match, file) {
  if (!isProviderBlock(decoratorBlock(src, match.index))) {
    return []
  }
  const bodyStart = src.indexOf('{', match.index) + 1
  return implicitParams(file, match[1], constructorParams(src, bodyStart))
}

function scanFile(file) {
  const src = readFileSync(file, 'utf8')
  if (!src.includes('constructor')) {
    return []
  }
  const hits = []
  for (const match of src.matchAll(/\bclass\s+([A-Za-z0-9_]+)[^{]*\{/g)) {
    hits.push(...scanClass(src, match, file))
  }
  return hits
}

function main() {
  const hits = []
  for (const root of roots) {
    if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
      process.stderr.write(`G22: каталог ${root} не найден\n`)
      return 2
    }
    for (const file of collectTsFiles(root)) {
      hits.push(...scanFile(file))
    }
  }
  if (hits.length === 0) {
    process.stdout.write(
      `✅ G22 OK (все параметры конструкторов провайдеров с явным @Inject; roots: ${roots.join(', ')})\n`,
    )
    return 0
  }
  process.stderr.write(`❌ G22 FAIL: неявный DI в ${hits.length} параметрах Nest-провайдеров\n`)
  for (const h of hits) {
    process.stderr.write(`   ${h}\n`)
  }
  process.stderr.write(
    '   emitDecoratorMetadata:false → Nest не выводит зависимость по типу: собирается,\n' +
      "   но в рантайме undefined («reading 'execute'»). Нужен @Inject(Token), токен —\n" +
      '   value-импортом. См. docs/ARCHITECTURE.md §5.3.\n',
  )
  return 1
}

process.exitCode = main()
