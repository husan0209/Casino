import { Injectable } from '@nestjs/common'

import { prisma } from '@casino/database'

import { type IUserSettingsRepository, type SelfExclusionStatus } from '../../domain/repositories/user-settings.repository'

@Injectable()
export class PrismaUserSettingsRepository implements IUserSettingsRepository {
  async findSelfExclusion(userId: string): Promise<SelfExclusionStatus | null> {
    const row = await prisma.userSettings.findUnique({ where: { userId } })
    if (!row?.selfExcludedUntil) return null
    // Treat expired exclusions as "no exclusion" so the caller does not need to
    // compare timestamps (and so we do not leak the historical value).
    if (row.selfExcludedUntil <= new Date()) return null
    return { excludedUntil: row.selfExcludedUntil }
  }
}
