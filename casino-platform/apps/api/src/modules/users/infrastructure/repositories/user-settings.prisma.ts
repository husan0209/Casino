import { Injectable } from '@nestjs/common'

import { prisma } from '@casino/database'

import {
  type IUserSettingsRepository,
  type UserExclusionSettings,
} from '../../domain/repositories/user-settings.repository'

@Injectable()
export class PrismaUserSettingsRepository implements IUserSettingsRepository {
  find(userId: string): Promise<UserExclusionSettings | null> {
    return prisma.userSettings.findUnique({
      where: { userId },
      select: { selfExcludedUntil: true, updatedAt: true },
    })
  }

  async upsertExclusion(userId: string, excludedUntil: Date): Promise<void> {
    await prisma.userSettings.upsert({
      where: { userId },
      update: { selfExcludedUntil: excludedUntil },
      create: {
        userId,
        selfExcludedUntil: excludedUntil,
        notificationsEmail: true,
        notificationsPush: true,
        twoFaEnabled: false,
        language: 'ru',
        timezone: 'Europe/Moscow',
      },
    })
  }

  async clearExclusion(userId: string): Promise<void> {
    await prisma.userSettings.update({
      where: { userId },
      data: { selfExcludedUntil: null },
    })
  }

  async revokeActiveSessions(userId: string): Promise<void> {
    await prisma.session.updateMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { revokedAt: new Date() },
    })
  }
}
