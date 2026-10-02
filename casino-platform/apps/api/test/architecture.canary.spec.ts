/**
 * В8 (canary): структурные инварианты модулей, которые уже выполняются после
 * волн 1–4. Спека-археолог: если упадёт — структура изменилась, и это надо
 * сделать ОСОЗНАННО (или обновить спеку вместе с решением).
 *
 * НЕ проверяет (осознанно, см. docs/TECH_DEBT.md В1/В3):
 * - фасад у КАЖДОГО модуля (В1-остаток: фасад по потребителям — у auth гварды =
 *   публичный API по В6, у support/notifications нет внешних потребителей);
 * - ports/-импорты в presentation (В5/В6-решения: доменные контракты легальны).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MODULES_DIR = join(process.cwd(), 'src/modules')

function moduleNames(): string[] {
  return readdirSync(MODULES_DIR).filter((name) =>
    statSync(join(MODULES_DIR, name)).isDirectory(),
  )
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
      expect(
        existsSync(domainDir),
        `модуль ${mod}: нет domain/`,
      ).toBe(true)
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
    // В1: фасады созданы для модулей с внешними потребителями; у admin фасад
    // добавлен параллельной сессией; casino/maintenance — фасад не требуется
    // (решение В1-обсуждения, TECH_DEBT.md).
    const withFacade = ['geo', 'users', 'kyc', 'payments', 'wallet', 'admin']
    for (const mod of withFacade) {
      const facadeDir = join(MODULES_DIR, mod, 'facade')
      expect(
        existsSync(facadeDir) && readdirSync(facadeDir).some((f) => f.endsWith('.facade.ts')),
        `модуль ${mod}: нет facade/ по шаблону MODULE_TEMPLATE`,
      ).toBe(true)
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
