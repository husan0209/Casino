/**
 * Сборка AdminModule (волна 4 / В3).
 *
 * Баг: #121 завела AdminSettingsService и AdminBroadcastService вместе с портами
 * SYSTEM_SETTING_REPOSITORY / ADMIN_BROADCAST_REPOSITORY, но не подключила их
 * к модулю — токены остались без провайдеров, а AdminSettingsController и
 * AdminNotificationsController не попали в `controllers`. Всё это молча
 * компилировалось: гард G22 проверяет наличие @Inject на параметрах конструктора
 * (он был), но не проверяет, что токен чем-то предоставлен и что контроллер
 * вообще зарегистрирован. Итог: /admin/settings и /admin/notifications/send
 * отдавали 404, хотя apps/admin/src/app/dashboard/settings/page.tsx ходит туда
 * за настройками.
 *
 * Тест держит инвариант явно: оба порта предоставлены, оба контроллера стоят в
 * controllers, useClass под токеном реализует порт, а сами сервисы — в
 * providers. Нужен потому, что класс дефекта «сервис написан, но не подключён»
 * гардами не покрыт.
 */
import { describe, expect, it, vi } from 'vitest'

import type * as CasinoDatabase from '@casino/database'

import { AdminModule } from '../src/modules/admin/admin.module'
import { AdminBroadcastService } from '../src/modules/admin/application/admin-broadcast.service'
import { AdminSettingsService } from '../src/modules/admin/application/admin-settings.service'
import {
  ADMIN_BROADCAST_REPOSITORY,
  SYSTEM_SETTING_REPOSITORY,
  type IAdminBroadcastRepository,
  type ISystemSettingRepository,
} from '../src/modules/admin/domain/system.repository'
import {
  PrismaAdminBroadcastRepository,
  PrismaSystemSettingRepository,
} from '../src/modules/admin/infrastructure/admin-system.prisma.repository'
import { AdminNotificationsController } from '../src/modules/admin/presentation/controllers/admin-notifications.controller'
import { AdminSettingsController } from '../src/modules/admin/presentation/controllers/admin-settings.controller'

// AdminModule тянет WalletModule, а тот — wallet.controller → list-transactions.dto,
// который на уровне модуля читает LedgerEntryType из @casino/database. Поэтому
// мок частичный: реальные enum'ы и типы сохраняем, подменяем только prisma-клиент
// (тест проверяет метаданные модуля, а не запросы к БД).
vi.mock('@casino/database', async (importOriginal) => {
  const actual = await importOriginal<typeof CasinoDatabase>()
  return { ...actual, prisma: {} }
})

type ProviderDef = { provide: unknown; useClass: new (...args: never[]) => unknown }

// Nest складывает в `providers` и сами классы, и объекты {provide, useClass},
// поэтому метаданные шире, чем ProviderDef, — выборка по токену идёт через guard.
const providers = Reflect.getMetadata('providers', AdminModule) as readonly unknown[]
const controllers = Reflect.getMetadata('controllers', AdminModule) as readonly unknown[]

const isProviderDef = (value: unknown): value is ProviderDef =>
  typeof value === 'object' && value !== null && 'provide' in value

/** Класс, под которым модуль отдаёт токен; undefined — токен не предоставлен. */
const useClassFor = (token: unknown): ProviderDef['useClass'] | undefined =>
  providers.find((entry): entry is ProviderDef => isProviderDef(entry) && entry.provide === token)
    ?.useClass

describe('AdminModule: порты настроек и рассылки подключены', () => {
  it('SYSTEM_SETTING_REPOSITORY предоставлен и указывает на Prisma-реализацию', () => {
    // Arrange/Act — токен ищем в providers модуля
    // Assert
    expect(useClassFor(SYSTEM_SETTING_REPOSITORY)).toBe(PrismaSystemSettingRepository)
  })

  it('ADMIN_BROADCAST_REPOSITORY предоставлен и указывает на Prisma-реализацию', () => {
    // Arrange/Act/Assert
    expect(useClassFor(ADMIN_BROADCAST_REPOSITORY)).toBe(PrismaAdminBroadcastRepository)
  })

  it('реализация под SYSTEM_SETTING_REPOSITORY удовлетворяет порту', () => {
    // Arrange — контракт описан в domain/system.repository.ts
    const port: readonly (keyof ISystemSettingRepository)[] = [
      'findMany',
      'findEmailTemplates',
      'upsert',
    ]
    // Act
    const impl = new PrismaSystemSettingRepository()
    // Assert — ни один метод порта не должен потеряться
    for (const method of port) {
      expect(typeof impl[method]).toBe('function')
    }
  })

  it('реализация под ADMIN_BROADCAST_REPOSITORY удовлетворяет порту', () => {
    // Arrange
    const port: readonly (keyof IAdminBroadcastRepository)[] = ['getAllUserIds', 'createMany']
    // Act
    const impl = new PrismaAdminBroadcastRepository()
    // Assert
    for (const method of port) {
      expect(typeof impl[method]).toBe('function')
    }
  })

  it('оба сервиса числятся в providers (иначе контроллеры не получат зависимости)', () => {
    // Arrange — в packages/tsconfig/nest.json emitDecoratorMetadata:false, так что
    // контроллеры резолвят сервисы строго по @Inject-токену из providers модуля
    const required = [AdminSettingsService, AdminBroadcastService]
    // Act
    const missing = required.filter((svc) => !providers.includes(svc))
    // Assert
    expect(missing).toEqual([])
  })
})

describe('AdminModule: контроллеры настроек и рассылки зарегистрированы', () => {
  it('AdminSettingsController стоит в controllers', () => {
    // Arrange/Act/Assert — без регистрации @Controller('admin/settings') не поднимается
    expect(controllers).toContain(AdminSettingsController)
  })

  it('AdminNotificationsController стоит в controllers', () => {
    // Arrange/Act/Assert — без регистрации @Controller('admin/notifications') не поднимается
    expect(controllers).toContain(AdminNotificationsController)
  })
})
