/**
 * GAP-62: запись в `system_settings` делает владелец таблицы (admin), и сюда
 * приходят чужие ключи — affiliate пишет свои настройки через `AdminFacade`.
 *
 * Спека держит два свойства upsert'а, без которых маршрут через фасад был бы
 * потерей данных:
 *  1) `category` попадает и в create, и в update — иначе группировка
 *     «affiliate» в админ-UI теряется при первой же перезаписи ключа;
 *  2) `type` применяется на update — заявленный тип ключа обязан совпадать с
 *     типом строки, иначе чтение из другой ветки получает значение чужого типа.
 *
 * Плюс — что фасад не переизобретает запись, а отдаёт её порту.
 */
import { describe, expect, it, vi } from 'vitest'

import type * as CasinoDatabase from '@casino/database'

const upsert = vi.fn()

vi.mock('@casino/database', async (importOriginal) => {
  const actual = await importOriginal<typeof CasinoDatabase>()
  return { ...actual, prisma: { systemSetting: { upsert: (args: unknown) => upsert(args) } } }
})

import { AdminSettingsService } from '../src/modules/admin/application/admin-settings.service'
import { AdminFacade } from '../src/modules/admin/facade/admin.facade'
import { PrismaSystemSettingRepository } from '../src/modules/admin/infrastructure/admin-system.prisma.repository'

import type { ISystemSettingRepository } from '../src/modules/admin/domain/system.repository'

const ROW = {
  id: 's-1',
  key: 'affiliate_default_revshare_rate',
  value: '7.5',
  type: 'number',
  category: 'affiliate',
  description: null,
  updatedBy: 'a1',
  updatedAt: new Date('2026-10-04T00:00:00.000Z'),
}

describe('PrismaSystemSettingRepository.upsert — payload для чужого ключа', () => {
  const repo = new PrismaSystemSettingRepository()

  it('category уходит и в create, и в update', async () => {
    upsert.mockReset().mockResolvedValue(ROW)

    await repo.upsert({
      key: 'affiliate_default_revshare_rate',
      value: '7.5',
      type: 'number',
      updatedBy: 'a1',
      category: 'affiliate',
    })

    const args = upsert.mock.calls[0]![0] as {
      where: unknown
      update: Record<string, unknown>
      create: Record<string, unknown>
    }
    expect(args.where).toEqual({ key: 'affiliate_default_revshare_rate' })
    expect(args.update).toEqual({
      value: '7.5',
      type: 'number',
      updatedBy: 'a1',
      category: 'affiliate',
    })
    expect(args.create).toEqual({
      key: 'affiliate_default_revshare_rate',
      value: '7.5',
      type: 'number',
      updatedBy: 'a1',
      category: 'affiliate',
    })
  })

  it('без category поле не включается: create не получает undefined (exactOptionalPropertyTypes)', async () => {
    upsert.mockReset().mockResolvedValue(ROW)

    await repo.upsert({ key: 'smtp_from', value: 'a@b.c', type: 'string', updatedBy: 'a2' })

    const args = upsert.mock.calls[0]![0] as {
      update: Record<string, unknown>
      create: Record<string, unknown>
    }
    expect(args.update).not.toHaveProperty('category')
    expect(args.create).not.toHaveProperty('category')
  })
})

describe('AdminFacade.setSystemSetting — маршрут вместо чужого prisma', () => {
  it('фасад отдаёт запись сервису настроек и не работает с prisma сам', async () => {
    const seen: unknown[] = []
    const settings = {
      upsert: async (input: unknown) => {
        seen.push(input)
        return ROW
      },
    } as unknown as ISystemSettingRepository
    const facade = new AdminFacade(
      { log: async () => undefined } as never,
      new AdminSettingsService(settings),
    )

    const res = await facade.setSystemSetting({
      key: 'affiliate_default_revshare_rate',
      value: '7.5',
      type: 'number',
      updatedBy: 'a1',
      category: 'affiliate',
    })

    expect(seen).toHaveLength(1)
    expect(seen[0]).toEqual({
      key: 'affiliate_default_revshare_rate',
      value: '7.5',
      type: 'number',
      updatedBy: 'a1',
      category: 'affiliate',
    })
    expect(res).toEqual(ROW)
  })
})
