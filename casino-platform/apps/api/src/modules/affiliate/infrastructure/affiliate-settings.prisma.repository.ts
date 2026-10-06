/**
 * Реализация порта настроек партнёрской программы.
 *
 * Чтение — `system_settings` напрямую: межмодульное чтение разрешено и
 * зафиксировано ADR (GAP-51), детектор записей его не считает.
 *
 * Запись — через `AdminFacade`: таблица принадлежит admin (карта
 * `MODEL_OWNERS`, гард G24), и affiliate не имеет права делать в ней upsert
 * сам (GAP-62). Категория `affiliate` при этом задаёт именно этот модуль —
 * он знает, какие ключи его, а admin лишь пишет то, что ему передали.
 */
import { Inject, Injectable } from '@nestjs/common'

import { AdminFacade } from '@modules/admin/facade/admin.facade'

import { prisma } from '@casino/database'

import {
  type AffiliateSettingKey,
  type AffiliateSettingType,
  type AffiliateSettingsRepository,
  type RawSetting,
} from '../domain/affiliate-settings'

/** Категория для группировки настроек в админ-UI. */
const AFFILIATE_CATEGORY = 'affiliate'

@Injectable()
export class PrismaAffiliateSettingsRepository implements AffiliateSettingsRepository {
  constructor(@Inject(AdminFacade) private readonly adminSettings: AdminFacade) {}

  async listRaw(): Promise<RawSetting[]> {
    const rows = await prisma.systemSetting.findMany({
      where: { key: { startsWith: 'affiliate_' } },
      orderBy: { key: 'asc' },
    })
    return rows.map((row) => ({
      key: row.key,
      value: row.value,
      type: row.type as AffiliateSettingType,
      category: row.category,
      description: row.description,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
    }))
  }

  async set(args: {
    key: AffiliateSettingKey
    value: string
    type: AffiliateSettingType
    updatedBy: string
  }): Promise<void> {
    await this.adminSettings.setSystemSetting({
      key: args.key,
      value: args.value,
      type: args.type,
      updatedBy: args.updatedBy,
      category: AFFILIATE_CATEGORY,
    })
  }
}
