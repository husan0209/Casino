/**
 * G24: рассылку пишет владелец таблицы `notifications`, а не admin.
 *
 * До переезда `admin/infrastructure/admin-system.prisma.repository.ts` делал
 * `prisma.notification.createMany` — запись в чужую таблицу (карта MODEL_OWNERS:
 * `Notification` = notifications). Формат уведомления (канал, default `data`,
 * `isRead`) при этом существовал в двух местах.
 *
 * Спека держит:
 *  1) payload prisma-реализации — канал internal, isRead false, `data` НЕ
 *     передаётся (у колонки default в схеме; явный `{}` здесь означал бы, что
 *     модуль сам решает, что писать в чужое поле);
 *  2) `createMany` возвращает count, а не длину входа — это и есть sentCount;
 *  3) цепочка фасад → сервис → порт тонкая, своей логики в facade нет;
 *  4) сборка: NotificationsModule экспортирует фасад, AdminModule импортирует
 *     модуль, и у admin-репозитория больше нет метода записи.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CasinoDatabase from '@casino/database'

const createMany = vi.fn()

vi.mock('@casino/database', async (importOriginal) => {
  const actual = await importOriginal<typeof CasinoDatabase>()
  return {
    ...actual,
    prisma: { notification: { createMany: (args: unknown) => createMany(args) } },
  }
})

import { AdminModule } from '../src/modules/admin/admin.module'
import { PrismaAdminBroadcastRepository } from '../src/modules/admin/infrastructure/admin-system.prisma.repository'
import { NotificationService } from '../src/modules/notifications/application/notification.service'
import {
  type INotificationRepository,
  type NotificationRow,
} from '../src/modules/notifications/domain/notification.repository'
import { NotificationsFacade } from '../src/modules/notifications/facade/notifications.facade'
import { PrismaNotificationRepository } from '../src/modules/notifications/infrastructure/notification.prisma.repository'
import { NotificationsModule } from '../src/modules/notifications/notifications.module'

beforeEach(() => {
  createMany.mockReset().mockResolvedValue({ count: 2 })
})

describe('PrismaNotificationRepository.createMany', () => {
  const repo = new PrismaNotificationRepository()

  it('пишет канал internal и isRead false, data не трогает', async () => {
    await repo.createMany([
      { userId: 'u1', type: 'promo', title: 'Акция', message: 'Тело' },
      { userId: 'u2', type: 'system', title: 'Тех', message: 'Работы' },
    ])

    const args = createMany.mock.calls[0]![0] as { data: Array<Record<string, unknown>> }
    expect(args.data).toHaveLength(2)
    expect(args.data[0]).toEqual({
      userId: 'u1',
      type: 'promo',
      channel: 'internal',
      title: 'Акция',
      message: 'Тело',
      isRead: false,
    })
    expect(args.data[1]).not.toHaveProperty('data')
  })

  it('отдаёт count из БД, а не rows.length', async () => {
    createMany.mockResolvedValue({ count: 1 })

    const res = await repo.createMany([
      { userId: 'u1', type: 'promo', title: 'T', message: 'M' },
      { userId: 'u2', type: 'promo', title: 'T', message: 'M' },
    ])

    expect(res).toBe(1)
  })

  it('пустой список адресатов — 0 без исключения (как было в admin-репозитории)', async () => {
    createMany.mockResolvedValue({ count: 0 })

    await expect(repo.createMany([])).resolves.toBe(0)
    expect(createMany).toHaveBeenCalledTimes(1)
  })
})

describe('NotificationsFacade.broadcastInternal', () => {
  it('фасад делегирует сервису и не добавляет своей логики', async () => {
    const rows = [{ userId: 'u1', type: 'promo', title: 'T', message: 'M' }]
    const repo: Partial<INotificationRepository> = {
      createMany: async (input) => input.length,
      create: async () => ({ id: 'n-1' }) as NotificationRow,
    }
    const facade = new NotificationsFacade(
      new NotificationService({} as never, repo as INotificationRepository),
    )

    await expect(facade.broadcastInternal(rows)).resolves.toBe(1)
  })
})

describe('Сборка admin → notifications (G24)', () => {
  const notificationsExports = Reflect.getMetadata('exports', NotificationsModule) as unknown[]
  const adminImports = Reflect.getMetadata('imports', AdminModule) as unknown[]

  it('NotificationsModule отдаёт фасад наружу', () => {
    expect(notificationsExports).toContain(NotificationsFacade)
  })

  it('AdminModule импортирует NotificationsModule — иначе фасад нерезолвим', () => {
    expect(adminImports).toContain(NotificationsModule)
  })

  it('у репозитория рассылки не осталось метода записи', () => {
    const prototype = PrismaAdminBroadcastRepository.prototype as unknown as Record<string, unknown>
    expect(prototype).not.toHaveProperty('createMany')
    // чтение адресатов осталось и легально по ADR GAP-51
    expect(typeof prototype['getAllUserIds']).toBe('function')
  })
})
