/**
 * Юнит-тесты сервисов волны 4 (В3): настройки/шаблоны и массовая рассылка.
 *
 * До этого PR у обоих сервисов не было ни одного теста: #121 добавил их вместе
 * с портами, но покрытие осталось на нуле. Гард G21 следит только за файлами
 * *.use-case.ts, поэтому application/*.service.ts остаётся вне его радара.
 * Отдельно закрыт бизнес-критерий GAP-21: пустой userIds = рассылка всем.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AdminBroadcastService } from '../src/modules/admin/application/admin-broadcast.service'
import { AdminSettingsService } from '../src/modules/admin/application/admin-settings.service'
import {
  type IAdminBroadcastRepository,
  type ISystemSettingRepository,
  type NotificationBroadcastInput,
  type SystemSettingRow,
} from '../src/modules/admin/domain/system.repository'

const ROW: SystemSettingRow = {
  id: 's1',
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  type: 'string',
  description: null,
  key: 'registration_bonus',
  value: '500',
  category: 'bonuses',
  updatedBy: 'a1',
}

const settingRepo = {
  findMany: vi.fn(),
  findEmailTemplates: vi.fn(),
  upsert: vi.fn(),
}

const broadcastRepo = {
  getAllUserIds: vi.fn(),
  createMany: vi.fn(),
}

const settings = new AdminSettingsService(settingRepo as unknown as ISystemSettingRepository)

const broadcast = new AdminBroadcastService(broadcastRepo as unknown as IAdminBroadcastRepository)

beforeEach(() => {
  settingRepo.findMany.mockReset().mockResolvedValue([ROW])
  settingRepo.findEmailTemplates.mockReset().mockResolvedValue([{ ...ROW, type: 'json' }])
  settingRepo.upsert.mockReset().mockResolvedValue(ROW)
  broadcastRepo.getAllUserIds.mockReset().mockResolvedValue([])
  broadcastRepo.createMany.mockReset().mockResolvedValue(undefined)
})

describe('AdminSettingsService — тонкий делегат к порту', () => {
  it('list отдаёт все настройки', async () => {
    // Arrange/Act
    const res = await settings.list()
    // Assert
    expect(settingRepo.findMany).toHaveBeenCalledTimes(1)
    expect(res).toEqual([ROW])
  })

  it('listEmailTemplates идёт в findEmailTemplates, а не в общий findMany', async () => {
    // Arrange/Act
    const res = await settings.listEmailTemplates()
    // Assert — шаблоны отфильтрованы на уровне репозитория, сервис не фильтрует
    expect(settingRepo.findEmailTemplates).toHaveBeenCalledTimes(1)
    expect(settingRepo.findMany).not.toHaveBeenCalled()
    expect(res[0]?.type).toBe('json')
  })

  it('upsert пробрасывает аргументы без изменений', async () => {
    // Arrange — type приходит уже нормализованным контроллером
    const input = {
      key: 'registration_bonus',
      value: '750',
      type: 'string' as const,
      updatedBy: 'a1',
    }
    // Act
    const res = await settings.upsert(input)
    // Assert
    expect(settingRepo.upsert).toHaveBeenCalledWith(input)
    expect(res).toEqual(ROW)
  })
})

describe('AdminBroadcastService.send — адресаты', () => {
  it('явные userIds → рассылка только им, список всех НЕ подтягивается', async () => {
    // Arrange — выборочная рассылка не должна ходить в БД за всеми пользователями
    const userIds = ['u1', 'u2']
    // Act
    const res = await broadcast.send(userIds, { title: 'T', message: 'M', type: 'system' })
    // Assert
    expect(broadcastRepo.getAllUserIds).not.toHaveBeenCalled()
    expect(broadcastRepo.createMany).toHaveBeenCalledTimes(1)
    expect(res).toEqual({ success: true, sentCount: 2 })
  })

  it('пустой userIds (GAP-21) → рассылка всем пользователям', async () => {
    // Arrange — схема SendNotificationSchema дефолтит userIds в [], это «всем»
    broadcastRepo.getAllUserIds.mockResolvedValue(['u1', 'u2', 'u3'])
    // Act
    const res = await broadcast.send([], { title: 'T', message: 'M', type: 'system' })
    // Assert
    expect(broadcastRepo.getAllUserIds).toHaveBeenCalledTimes(1)
    const sent = broadcastRepo.createMany.mock.calls[0]?.[0] as NotificationBroadcastInput[]
    expect(sent.map((n) => n.userId)).toEqual(['u1', 'u2', 'u3'])
    expect(res.sentCount).toBe(3)
  })

  it('пустой userIds и пустая БД → sentCount 0, без исключения', async () => {
    // Arrange
    broadcastRepo.getAllUserIds.mockResolvedValue([])
    // Act
    const res = await broadcast.send([], { title: 'T', message: 'M', type: 'system' })
    // Assert — createMany с пустым массивом Prisma принимает
    expect(res).toEqual({ success: true, sentCount: 0 })
  })
})

describe('AdminBroadcastService.send — форма уведомления', () => {
  it('пустой type → дефолт system', async () => {
    // Arrange — SendNotificationSchema делает type опциональным
    // Act
    await broadcast.send(['u1'], { title: 'T', message: 'M', type: '' })
    // Assert
    const sent = broadcastRepo.createMany.mock.calls[0]?.[0] as NotificationBroadcastInput[]
    expect(sent[0]?.type).toBe('system')
  })

  it('каждое уведомление: channel internal, isRead false, title/message из payload', async () => {
    // Arrange
    // Act
    await broadcast.send(['u1', 'u2'], { title: 'Акция', message: 'Тело', type: 'promo' })
    // Assert
    expect(broadcastRepo.createMany).toHaveBeenCalledWith([
      {
        userId: 'u1',
        title: 'Акция',
        message: 'Тело',
        type: 'promo',
        channel: 'internal',
        isRead: false,
      },
      {
        userId: 'u2',
        title: 'Акция',
        message: 'Тело',
        type: 'promo',
        channel: 'internal',
        isRead: false,
      },
    ])
  })
})
