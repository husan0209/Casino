/**
 * Prisma-реализация порта настроек партнёрской программы.
 *
 * Пишет/читает существующую таблицу system_settings по ключам с префиксом
 * `affiliate_`. Кэш в памяти живёт в AffiliateSettingsService (application),
 * здесь только доступ к данным.
 */
import { Injectable } from '@nestjs/common'

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
    await prisma.systemSetting.upsert({
      where: { key: args.key },
      update: {
        value: args.value,
        type: args.type,
        category: AFFILIATE_CATEGORY,
        updatedBy: args.updatedBy,
      },
      create: {
        key: args.key,
        value: args.value,
        type: args.type,
        category: AFFILIATE_CATEGORY,
        updatedBy: args.updatedBy,
      },
    })
  }
}
