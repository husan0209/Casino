import { Injectable } from '@nestjs/common'

import { prisma, type SystemSettingType } from '@casino/database'

import {
  type IAdminBroadcastRepository,
  type NotificationBroadcastInput,
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
  }): Promise<SystemSettingRow> {
    return prisma.systemSetting.upsert({
      where: { key: input.key },
      update: { value: input.value, updatedBy: input.updatedBy },
      create: {
        key: input.key,
        value: input.value,
        type: input.type,
        updatedBy: input.updatedBy,
      },
    })
  }
}

@Injectable()
export class PrismaAdminBroadcastRepository implements IAdminBroadcastRepository {
  async getAllUserIds(): Promise<string[]> {
    const allUsers = await prisma.user.findMany({ select: { id: true } })
    return allUsers.map((u) => u.id)
  }

  async createMany(notifications: NotificationBroadcastInput[]): Promise<void> {
    await prisma.notification.createMany({ data: notifications })
  }
}
