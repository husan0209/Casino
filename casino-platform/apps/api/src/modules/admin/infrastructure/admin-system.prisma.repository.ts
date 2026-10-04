import { Injectable } from '@nestjs/common'

import { prisma, type SystemSettingType } from '@casino/database'

import {
  type IAdminBroadcastRepository,
  type ISystemSettingRepository,
  type SystemSettingRow,
} from '../domain/system.repository'

@Injectable()
export class PrismaSystemSettingRepository implements ISystemSettingRepository {
  async findMany(): Promise<SystemSettingRow[]> {
    return prisma.systemSetting.findMany()
  }

  async findEmailTemplates(): Promise<SystemSettingRow[]> {
    return prisma.systemSetting.findMany({
      where: { key: { startsWith: 'email_template_' } },
    })
  }

  async upsert(input: {
    key: string
    value: string
    type: SystemSettingType
    updatedBy: string
    category?: string | undefined
  }): Promise<SystemSettingRow> {
    // exactOptionalPropertyTypes: явный undefined Prisma не принимает — поле
    // включается в data только когда его задали.
    const category = input.category !== undefined ? { category: input.category } : {}
    return prisma.systemSetting.upsert({
      where: { key: input.key },
      update: { value: input.value, type: input.type, updatedBy: input.updatedBy, ...category },
      create: {
        key: input.key,
        value: input.value,
        type: input.type,
        updatedBy: input.updatedBy,
        ...category,
      },
    })
  }
}

/**
 * Список адресатов рассылки. Только ЧТЕНИЕ таблицы `users` — оно легализовано
 * ADR GAP-51; запись в `notifications` отсюда ушла (G24): её делает
 * `NotificationsFacade` из модуля уведомлений.
 */
@Injectable()
export class PrismaAdminBroadcastRepository implements IAdminBroadcastRepository {
  async getAllUserIds(): Promise<string[]> {
    const allUsers = await prisma.user.findMany({ select: { id: true } })
    return allUsers.map((u) => u.id)
  }
}
