/**
 * В8 (canary): структурные инварианты модулей, которые уже выполняются после
 * волн 1–4. Спека-археолог: если упадёт — структура изменилась, и это надо
 * сделать ОСОЗНАННО (или обновить спеку вместе с решением).
 *
 * Правило фасадов (решение В1, 2026-10): фасад обязателен модулю, который
 * ПОТРЕБЛЯЕТСЯ ИЗВНЕ, а не каждому модулю. Список «кого дёргают» не пишется
 * на глаз — он считается ниже по импортам `modules/<mod>/<слой>/` из чужих
 * модулей (facade-импорты, deep-импорты и guard'ы считаются потреблением;
 * импорты чужого `<mod>.module.ts` — нет: это связи DI-графа, не API).
 * Отдельно зафиксирован снимок этого списка: новый потребитель появляется
 * вместе с новым фасадом и осознанным обновлением снимка.
 *
 * НЕ проверяет (осознанно, см. docs/MODULE_TEMPLATE.md Шаг 8,
 * docs/MODULE_BOUNDARIES.md §16.2):
 * - фасад у КАЖДОГО модуля: у casino/health/maintenance/notifications/support
 *   внешних потребителей нет — отсутствие фасада там не нарушение, а
 *   реализация правила (5 файлов-формальностей = 5 мест дрейфа);
 * - фасад у auth: его публичный API — guard'ы (решение В6.1, §2.5/§13.2.1);
 * - ports/-импорты в presentation (В5/В6-решения: доменные контракты легальны).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MODULES_DIR = join(process.cwd(), 'src/modules')

/** Слои, импорт которых из другого модуля делает тот модуль «потребляемым». */
const MODULE_LAYERS = ['domain', 'application', 'infrastructure', 'presentation', 'facade'] as const

/** Публичный API модуля = guard'ы вместо фасада (решение В6.1, §2.5 auth). */
const GUARD_API_MODULES = ['auth']

/**
 * Снимок на 2026-10 (после В1: добавлен referrals). Сверялся грейпом по
 * импортам, а не памятью: если модуль сюда попадёт — у него есть внешний
 * потребитель и обязан быть фасад; если выпадет — потребление исчезло.
 */
const CONSUMED_MODULE_SNAPSHOT = [
  'admin',
  'affiliate',
  'geo',
  'kyc',
  'payments',
  'referrals',
  'users',
  'wallet',
]

/** Модули без внешних потребителей: фасад от них требовать нельзя (В1). */
const NO_CONSUMER_MODULE_SNAPSHOT = ['casino', 'health', 'maintenance', 'notifications', 'support']

/** Межмодульный импорт одного из слоёв/фасада/гарда другого модуля. */
const CROSS_MODULE_IMPORT_PATTERN = new RegExp(`/([a-z][a-z0-9-]*)/(${MODULE_LAYERS.join('|')})/`)

interface CrossModuleEdge {
  consumerModule: string
  consumedModule: string
  specifier: string
  file: string
}

function moduleNames(): string[] {
  return readdirSync(MODULES_DIR).filter((name) => statSync(join(MODULES_DIR, name)).isDirectory())
}

/** Все .ts-файлы модуля (спеки и декорации не считаются — они не код модуля). */
function collectSourceFiles(directory: string, collected: string[]): string[] {
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry)
    if (statSync(fullPath).isDirectory()) {
      collectSourceFiles(fullPath, collected)
    } else if (
      fullPath.endsWith('.ts') &&
      !fullPath.endsWith('.spec.ts') &&
      !fullPath.endsWith('.d.ts')
    ) {
      collected.push(fullPath)
    }
  }
  return collected
}

/** Модуль-цель импорта, если он обращается к слою/фасаду/гарду другого модуля. */
function consumedModuleOf(specifier: string, knownModules: string[]): string | null {
  const match = CROSS_MODULE_IMPORT_PATTERN.exec(specifier.replace(/\\/g, '/'))
  const targetModule = match?.[1]
  if (!targetModule) {
    return null
  }
  return knownModules.includes(targetModule) ? targetModule : null
}

/**
 * Рёбра «кто кого дёргает» по импортам. Относительные (`../../wallet/facade/…`),
 * алиасные (`@modules/admin/…`) и путевые (`../admin/presentation/…`) формы
 * одинаковы по сигнатуре `/<mod>/<слой>/`, поэтому разбираются одним шаблоном.
 */
function crossModuleEdges(): CrossModuleEdge[] {
  const knownModules = moduleNames()
  const edges: CrossModuleEdge[] = []
  for (const consumerModule of knownModules) {
    const sourceFiles = collectSourceFiles(join(MODULES_DIR, consumerModule), [])
    for (const file of sourceFiles) {
      const content = readFileSync(file, 'utf-8')
      for (const importMatch of content.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const specifier = importMatch[1]
        if (!specifier) {
          continue
        }
        const consumedModule = consumedModuleOf(specifier, knownModules)
        if (consumedModule === null || consumedModule === consumerModule) {
          continue
        }
        edges.push({ consumerModule, consumedModule, specifier, file })
      }
    }
  }
  return edges
}

function consumedModules(): Set<string> {
  const targets = new Set<string>()
  for (const edge of crossModuleEdges()) {
    targets.add(edge.consumedModule)
  }
  return targets
}

/** Фасад по шаблону MODULE_TEMPLATE Шаг 8: `facade/<mod>.facade.ts`. */
function hasTemplateFacade(mod: string): boolean {
  const facadeDir = join(MODULES_DIR, mod, 'facade')
  if (!existsSync(facadeDir)) {
    return false
  }
  return readdirSync(facadeDir).some((name) => name.endsWith('.facade.ts'))
}

/** Модули, которым фасад обязан (потребляются извне), кроме guard-API (В6.1). */
function facadeRequiredModules(): string[] {
  return [...consumedModules()].filter((mod) => !GUARD_API_MODULES.includes(mod)).sort()
}

describe('В8 canary: структура admin-модулей', () => {
  it('у каждого нетонкого модуля есть application/ и presentation/', () => {
    for (const mod of moduleNames()) {
      expect(
        existsSync(join(MODULES_DIR, mod, 'application')),
        `модуль ${mod}: нет application/`,
      ).toBe(true)
      expect(
        existsSync(join(MODULES_DIR, mod, 'presentation')),
        `модуль ${mod}: нет presentation/`,
      ).toBe(true)
    }
  })

  it('у каждого нетонкого модуля есть domain/ (модули с ошибками имеют errors/)', () => {
    for (const mod of moduleNames()) {
      const domainDir = join(MODULES_DIR, mod, 'domain')
      // health — infra-probe по решению В2: без домена
      if (mod === 'health') {
        continue
      }
      expect(existsSync(domainDir), `модуль ${mod}: нет domain/`).toBe(true)
      // errors/ обязателен только для модулей, которые уже бросают ошибки:
      // notifications легально не имеет доменных ошибок (В3-конверсия не добавляла).
      const errorsDir = join(domainDir, 'errors')
      const hasErrorFile = existsSync(errorsDir) || existsSync(join(domainDir, 'errors.ts'))
      if (!hasErrorFile) {
        continue
      }
      expect(
        existsSync(errorsDir) || existsSync(join(domainDir, 'errors.ts')),
        `модуль ${mod}: errors/ существует — консистентность сохранена`,
      ).toBe(true)
    }
  })

  it('у модулей с внешними потребителями есть фасад по шаблону', () => {
    // В1: фасад нужен тому, кого дёргают из других модулей. Потребители
    // считаются грейпом по импортам (crossModuleEdges), а не списком в спеке.
    const required = facadeRequiredModules()
    expect(
      required.length,
      'ни одного потребляемого модуля — разбор импортов сломан',
    ).toBeGreaterThan(0)
    for (const mod of required) {
      expect(
        hasTemplateFacade(mod),
        `модуль ${mod}: его импортируют из других модулей, но нет facade/<mod>.facade.ts (MODULE_TEMPLATE Шаг 8)`,
      ).toBe(true)
    }
  })

  it('список потребляемых модулей совпадает со снимком (дрейф межимпортации)', () => {
    // Новый потребитель = новый фасад (или осознанное решение класса В6.1) —
    // иначе модуль молча начинает торчать чужим application/infrastructure.
    const consumed = facadeRequiredModules()
    const missingFromSnapshot = consumed.filter((mod) => !CONSUMED_MODULE_SNAPSHOT.includes(mod))
    const goneFromSnapshot = CONSUMED_MODULE_SNAPSHOT.filter((mod) => !consumed.includes(mod))
    expect(
      missingFromSnapshot,
      `новые внешние потребители без обновления снимка: ${missingFromSnapshot.join(', ')}`,
    ).toEqual([])
    expect(
      goneFromSnapshot,
      `внешних потребителей больше нет — снимок надо ужать: ${goneFromSnapshot.join(', ')}`,
    ).toEqual([])
  })

  it('у модулей без внешних потребителей фасада нет — и требовать его нельзя', () => {
    // Реализация правила В1: казённый фасад у тех, кого никто не дёргает, —
    // место дрейфа без выигранного ограничения. Отсутствие не нарушение.
    const consumed = consumedModules()
    const noConsumer = [...NO_CONSUMER_MODULE_SNAPSHOT].sort()
    const unexpectedlyConsumed = noConsumer.filter((mod) => consumed.has(mod))
    expect(
      unexpectedlyConsumed,
      `модуль обзавёлся внешним потребителем — по В1 ему нужен фасад: ${unexpectedlyConsumed.join(', ')}`,
    ).toEqual([])
    for (const mod of noConsumer) {
      expect(hasTemplateFacade(mod), `модуль ${mod}: потребителей нет, фасад не нужен`).toBe(false)
    }
  })

  it('domain health/maintenance-модулей не импортирует @nestjs (G15-дубль на файловой модели)', () => {
    const violations: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) {
          walk(full)
        } else if (full.endsWith('.ts') && !full.endsWith('.spec.ts') && !full.endsWith('.d.ts')) {
          const content = readFileSync(full, 'utf-8')
          if (/from\s+['"]@nestjs\//.test(content)) {
            violations.push(full)
          }
        }
      }
    }
    for (const mod of moduleNames()) {
      const domainDir = join(MODULES_DIR, mod, 'domain')
      if (existsSync(domainDir)) {
        walk(domainDir)
      }
    }
    expect(violations, `domain с @nestjs: ${violations.join(', ')}`).toHaveLength(0)
  })
})
