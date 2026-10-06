// G28: каждый параметр HTTP-хендлера обязан нести param-декоратор.
//
// Зачем: Nest собирает аргументы хендлера из ROUTE_ARGS_METADATA — то, что не
// задекорировано, приезжает в метод как `undefined`. Такой контроллер компилируется,
// проходит tsc и ESLint, поднимается и даже отвечает на других маршрутах:
//   const affiliate = await this.requireAffiliate(actor.affiliateId)  →  TypeError
// и GlobalExceptionFilter отдаёт 500 на ВСЕ эндпоинты класса. Кабинет партнёра жил
// так до #197: `/affiliate/me|dashboard|links|commissions|players` падали при любом
// токене, а UI без ветки `isError` показывал это как «Загрузка…».
//
// Почему проверка статическая: контрактная спека вызывает методы контроллера
// напрямую и передаёт актора аргументом — HTTP-связывание она подтвердить не может
// в принципе, поэтому ни один тест этот класс бага не ловил.
//
// Правило и примеры: docs/ARCHITECTURE.md §5.3, docs/API_CONVENTIONS.md §2.
//
//   node scripts/check-controller-params.mjs [каталог...]   (по умолчанию apps/api/src)
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const roots = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['apps/api/src']

/**
 * Декораторы HTTP-методов: сразу за ними идёт сигнатура хендлера.
 * `m` обязателен: хендлеры задекорированы с отступом, а без флага `^` цеплялся бы
 * только за начало файла — детектор «зелёный», потому что не нашёл ни одного @Get.
 */
const VERB_RE = /^[ \t]*@(Get|Post|Put|Patch|Delete|All|Options|Head)[ \t]*\(/gm

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

/** Индекс сразу за круглой скобкой, закрытой в паре к открытой на `open`. */
function afterParens(src, open) {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') {
      depth++
    } else if (src[i] === ')') {
      depth--
      if (depth === 0) {
        return i + 1
      }
    }
  }
  return src.length
}

/** Содержимое круглых скобок, открытых в позиции `open`. */
function matchParens(src, open) {
  return src.slice(open + 1, afterParens(src, open) - 1)
}

/**
 * Текст между предыдущей верхнеуровневой декларацией и началом класса — блок
 * декораторов этого класса (многострочные @Throttle({...}) попадают целиком).
 * Объявления ищем строго с начала строки: иначе `'class'` внутри строки-аргумента
 * (@Controller('admin/classes')) обрезал бы блок и класс потерял бы @Controller.
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

/** Индекс после пробелов и комментариев, начиная с `i`. */
function skipTrivia(src, i) {
  for (;;) {
    while (i < src.length && /\s/.test(src[i])) {
      i++
    }
    if (src[i] === '/' && src[i + 1] === '/') {
      const eol = src.indexOf('\n', i)
      i = eol < 0 ? src.length : eol + 1
      continue
    }
    if (src[i] === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      i = end < 0 ? src.length : end + 2
      continue
    }
    return i
  }
}

/** Индекс после `@Имя(...)`, начиная с позиции `@`. */
function skipDecorator(src, i) {
  const name = /^@[A-Za-z0-9_]+/.exec(src.slice(i))
  i += name === null ? 1 : name[0].length
  i = skipTrivia(src, i)
  return src[i] === '(' ? afterParens(src, i) : i
}

/**
 * От позиции после декоратора-глагола: пропустить пробелы, комментарии и
 * последующие декораторы (@Header, @HttpCode, @UsePipes…), затем взять имя метода
 * и вернуть позицию его `(`. null — сигнатура не распознана, метод пропускаем.
 */
function handlerOpenParen(src, from) {
  let i = skipTrivia(src, from)
  while (src[i] === '@') {
    i = skipTrivia(src, skipDecorator(src, i))
  }
  const sig =
    /^(?:async\s+|public\s+|private\s+|protected\s+|readonly\s+|static\s+)*([A-Za-z0-9_$]+)\s*(?:!\s*)?(?:<[^>]*>)?\(/.exec(
      src.slice(i),
    )
  if (sig === null) {
    return null
  }
  return { name: sig[1], open: i + sig[0].length - 1 }
}

const OPEN_CHARS = '([{<'
const CLOSE_CHARS = ')]}>'

/** Параметры хендлера верхнего уровня (вложенные <>/()/{} не режем по запятой). */
function splitParams(block) {
  const out = []
  let depth = 0
  let cur = ''
  for (const ch of block) {
    if (ch === ',' && depth === 0) {
      out.push(cur)
      cur = ''
      continue
    }
    const opened = OPEN_CHARS.includes(ch) ? 1 : 0
    const closed = CLOSE_CHARS.includes(ch) ? 1 : 0
    depth += opened - closed
    cur += ch
  }
  if (cur.trim() !== '') {
    out.push(cur)
  }
  return out
}

function scanClass(src, cls, file) {
  const hits = []
  let handlers = 0
  for (const verb of src.matchAll(VERB_RE)) {
    if (verb.index < cls.index) {
      continue
    }
    const afterDecorator = afterParens(src, verb.index + verb[0].length - 1)
    const handler = handlerOpenParen(src, afterDecorator)
    if (handler === null) {
      continue
    }
    handlers += 1
    for (const raw of splitParams(matchParens(src, handler.open))) {
      if (/^@/.test(raw.trim())) {
        continue
      }
      const line = src.slice(0, handler.open).split('\n').length
      const text = raw.trim().replace(/\s+/g, ' ').slice(0, 90)
      hits.push(`${file}:${line} ${cls[1]}.${handler.name} :: ${text}`)
    }
  }
  return { hits, handlers }
}

function scanFile(file) {
  const src = readFileSync(file, 'utf8')
  if (!src.includes('@Controller')) {
    return null
  }
  const hits = []
  let controllers = 0
  let handlers = 0
  for (const cls of src.matchAll(/\bclass\s+([A-Za-z0-9_]+)[^{]*\{/g)) {
    if (!/^@Controller\b/m.test(decoratorBlock(src, cls.index))) {
      continue
    }
    controllers += 1
    const result = scanClass(src, cls, file)
    handlers += result.handlers
    hits.push(...result.hits)
  }
  return { hits, controllers, handlers }
}

function main() {
  const hits = []
  let controllers = 0
  let handlers = 0
  for (const root of roots) {
    if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
      process.stderr.write(`G28: каталог ${root} не найден\n`)
      return 2
    }
    for (const file of collectTsFiles(root)) {
      const result = scanFile(file)
      if (result === null) {
        continue
      }
      controllers += result.controllers
      handlers += result.handlers
      hits.push(...result.hits)
    }
  }
  if (controllers === 0 || handlers === 0) {
    // Пустое дерево = сломанный детектор, а не «всё хорошо» (урок G25: гард,
    // который ничего не нашёл, молча зелёный).
    process.stderr.write(
      `❌ G28 FAIL: просканировано ${controllers} контроллеров и ${handlers} хендлеров ` +
        `(roots: ${roots.join(', ')}) — детектор ничего не нашёл, значит сломан он, не код.\n`,
    )
    return 1
  }
  if (hits.length === 0) {
    process.stdout.write(
      `✅ G28 OK (${controllers} контроллеров, ${handlers} хендлеров — все параметры с param-декоратором; roots: ${roots.join(', ')})\n`,
    )
    return 0
  }
  process.stderr.write(`❌ G28 FAIL: недекорированный параметр в ${hits.length} хендлерах\n`)
  for (const h of hits) {
    process.stderr.write(`   ${h}\n`)
  }
  process.stderr.write(
    '   Nest берёт аргументы только из ROUTE_ARGS_METADATA: параметр без @… приезжает\n' +
      '   undefined → TypeError в первой строке хендлера → 500 на всех эндпоинтах класса.\n' +
      '   Компилируется и проходит линтер, поэтому проверка статическая.\n' +
      '   Нужен @Body()/@Query()/@Param()/@Req()/@CurrentUser() — docs/ARCHITECTURE.md §5.3.\n',
  )
  return 1
}

process.exitCode = main()
