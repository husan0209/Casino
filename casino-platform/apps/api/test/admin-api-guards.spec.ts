/**
 * Guard-инвариант admin-API в доменных модулях.
 *
 * Дефект: admin-API контроллеры доменных модулей (/admin/games,
 * /admin/providers, /admin/support, /admin/referrals) висели на плеерском
 * AuthGuard — тот требует aud='user', а админ-панель ходит с токеном
 * aud='admin'. Каждый запрос отдавал 401, а интерсептор apps/admin считает
 * любой 401 концом сессии: панель выкидывало на логин при открытии «Игры»,
 * «Провайдеры», «Поддержка» и «Рефералы».
 *
 * Тест держит инвариант явно: эти контроллеры защищены AdminAuthGuard, а
 * плеерский AuthGuard из их цепочки убран. Класс дефекта «guard стоит, но от
 * чужого контура аутентификации» гардами качества не покрыт — ловится только
 * метадата-тест (образец: admin-module-wiring.spec.ts).
 */
import { describe, expect, it, vi } from 'vitest'

import type * as CasinoDatabase from '@casino/database'

import { AdminAuthGuard } from '../src/modules/admin/presentation/admin-auth.guard'
import { AuthGuard } from '../src/modules/auth/presentation/guards/auth.guard'
import { CasinoAdminController } from '../src/modules/casino/presentation/controllers/casino-admin.controller'
import { ReferralsAdminController } from '../src/modules/referrals/presentation/referrals-admin.controller'
import { SupportAdminController } from '../src/modules/support/presentation/controllers/support-admin.controller'

// Контроллеры импортируют prisma-клиент (@casino/database) на уровне модуля —
// в юнит-тесте он не нужен, подменяем пустым объектом: реальные enum'ы и типы
// сохраняем (см. admin-module-wiring.spec.ts).
vi.mock('@casino/database', async (importOriginal) => {
  const actual = await importOriginal<typeof CasinoDatabase>()
  return { ...actual, prisma: {} }
})

// @UseGuards складывает классы guard'ов в метаданные '__guards__' контроллера.
const guardsOf = (controller: object): readonly unknown[] =>
  (Reflect.getMetadata('__guards__', controller) as readonly unknown[] | undefined) ?? []

const adminApiControllers = [
  [
    'CasinoAdminController (/admin/games, /admin/providers, /admin/game-sessions*)',
    CasinoAdminController,
  ],
  ['SupportAdminController (/admin/support)', SupportAdminController],
  ['ReferralsAdminController (/admin/referrals)', ReferralsAdminController],
] as const

describe('admin-API доменных модулей под AdminAuthGuard', () => {
  it('CasinoAdminController: AdminAuthGuard в цепочке guard-ов', () => {
    // Arrange — метаданные снимаются с класса при импорте
    // Act
    const guards = guardsOf(CasinoAdminController)
    // Assert
    expect(guards).toContain(AdminAuthGuard)
  })

  it('SupportAdminController: AdminAuthGuard в цепочке guard-ов', () => {
    // Arrange/Act
    const guards = guardsOf(SupportAdminController)
    // Assert
    expect(guards).toContain(AdminAuthGuard)
  })

  it('ReferralsAdminController: AdminAuthGuard в цепочке guard-ов', () => {
    // Arrange/Act
    const guards = guardsOf(ReferralsAdminController)
    // Assert
    expect(guards).toContain(AdminAuthGuard)
  })

  it('плеерский AuthGuard убран со всех admin-API контроллеров', () => {
    // Arrange — токен aud='user' не должен подходить к admin-API
    // Act
    const leaky = adminApiControllers
      .map(([name, controller]) => [name, guardsOf(controller)] as const)
      .filter(([, guards]) => guards.includes(AuthGuard))
    // Assert
    expect(leaky).toEqual([])
  })
})
