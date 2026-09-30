/*
 * Автономный Node-скрипт проверки: CommonJS и без типов, поэтому правила
 * модулей приложения к нему неприменимы — require() и console здесь норма,
 * а type-aware правила видят только any.
 */
/* eslint-disable no-console, max-lines-per-function, max-depth, max-params, @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-condition */
/**
 * Проверка: все ли зависимости конструкторов инъецируются ЯВНЫМ @Inject.
 *
 * ЗАЧЕМ. В этой сборке (TypeScript 6 / tsgo) emitDecoratorMetadata не выдаёт
 * design:paramtypes. Nest читает SELF_DECLARED_DEPS_METADATA ('self:paramtypes'),
 * который наполняет только декоратор @Inject. Параметр без @Inject поэтому
 * получает токен undefined МОЛЧА — ни tsc, ни eslint, ни юнит-тесты это не
 * видят: тип резолвится, а значение в рантайме отсутствует.
 *
 * Обнаружено функциональным прогоном affiliate-flow.check.js: AffiliateSettingsService
 * приходила undefined во все use-case'ы, где токен был class'ом без @Inject.
 * Symbol-токены работали, потому что для них @Inject писался всегда.
 *
 * Правило проекта: @Inject на КАЖДЫЙ параметр конструктора, без исключений.
 *
 * Запуск: node apps/api/test/di-inject-audit.js [путь ...]
 */

const fs = require('node:fs')
const path = require('node:path')

const ts = require('typescript')

const roots = process.argv.slice(2)
const targets = roots.length > 0 ? roots : [path.join(__dirname, '..', 'src')]

/** Возвращает текстовое имя выражения-декоратора либо null. */
function decoratorName(node) {
  if (!ts.isCallExpression(node.expression)) {
    return null
  }
  const callee = node.expression.expression
  return ts.isIdentifier(callee) ? callee.text : null
}

/** Рекурсивно ищет нужный декоратор в параметре конструктора. */
function findDecorator(parameter, wanted) {
  const decorators = ts.canHaveDecorators(parameter) ? (ts.getDecorators(parameter) ?? []) : []
  for (const decorator of decorators) {
    if (decoratorName(decorator) === wanted) {
      return true
    }
  }
  return false
}

function report(file, node, kind) {
  const { line, character } = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart())
  return {
    file: path.relative(process.cwd(), file).replace(/\\/g, '/'),
    line: line + 1,
    column: character + 1,
    kind,
  }
}

const findings = []
let scannedClasses = 0
let scannedParams = 0

/**
 * Классы, которые Nest инстанцирует через DI.
 *
 * ВАЖНО: @Controller ТОЖЕ входит. Первая версия аудита смотрела только на
 * @Injectable и из-за этого пропустила AuthController: у него 10 зависимостей
 * без @Inject, и весь /auth/* отдавал 500. Проверять надо всё, что Nest
 * инстанцирует — и контроллеры в первую очередь.
 */
const DI_CLASS_DECORATORS = new Set(['Injectable', 'Controller'])

function isDiClass(node) {
  const decorators = ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : []
  return decorators.some((decorator) => DI_CLASS_DECORATORS.has(decoratorName(decorator) ?? ''))
}

function visitFile(file) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  )
  function walk(node) {
    // Только @Injectable-классы: у entity, классов ошибок и утилит конструктор
    // не является DI-зависимостью, и требование @Inject к нему неприменимо.
    if (ts.isClassDeclaration(node) && isDiClass(node)) {
      const ctor = node.members.find((member) => ts.isConstructorDeclaration(member))
      if (ctor !== undefined && ctor.parameters.length > 0) {
        scannedClasses++
        for (const parameter of ctor.parameters) {
          scannedParams++
          if (findDecorator(parameter, 'Inject')) {
            continue
          }
          const name = parameter.name.getText(source)
          // @Optional допускает undefined намеренно — это не дефект.
          if (findDecorator(parameter, 'Optional')) {
            continue
          }
          findings.push(
            report(
              file,
              parameter,
              `${node.name?.text ?? '<anonymous>'}: нет @Inject для "${name}"`,
            ),
          )
        }
      }
    }
    ts.forEachChild(node, walk)
  }
  walk(source)
}

function collect(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') {
        continue
      }
      out.push(...collect(full))
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(full)
    }
  }
  return out
}

for (const target of targets) {
  const stat = fs.existsSync(target) ? fs.statSync(target) : null
  if (stat === null) {
    console.error(`Путь не найден: ${target}`)
    process.exit(2)
  }
  const files = stat.isDirectory() ? collect(target) : [target]
  for (const file of files) {
    visitFile(file)
  }
}

console.log(`Конструкторов: ${scannedClasses}, параметров: ${scannedParams}`)
if (findings.length === 0) {
  console.log('OK: все параметры конструкторов имеют явный @Inject')
  process.exit(0)
}

console.log(`\nНАЙДЕНО параметров без @Inject: ${findings.length}`)
const byFile = new Map()
for (const finding of findings) {
  if (!byFile.has(finding.file)) {
    byFile.set(finding.file, [])
  }
  byFile.get(finding.file).push(finding)
}
for (const [file, items] of byFile) {
  console.log(`\n  ${file}`)
  for (const item of items) {
    console.log(`    :${item.line}:${item.column}  ${item.kind}`)
  }
}
process.exit(1)
