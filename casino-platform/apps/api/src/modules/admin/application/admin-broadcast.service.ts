import { Inject, Injectable } from '@nestjs/common'

import {
  type IAdminBroadcastRepository,
  ADMIN_BROADCAST_REPOSITORY,
} from '../domain/system.repository'

/** Массовая рассылка уведомлений (В3: prisma-direct вынесен из контроллера). */
@Injectable()
export class AdminBroadcastService {
  constructor(
    @Inject(ADMIN_BROADCAST_REPOSITORY) private readonly repo: IAdminBroadcastRepository,
  ) {}

  async send(
    userIds: string[],
    payload: { title: string; message: string; type: string },
  ): Promise<{ sentCount: number }> {
    let targets = userIds
    if (targets.length === 0) {
      targets = await this.repo.getAllUserIds()
    }
    const notifications = targets.map((userId) => ({
      userId,
      title: payload.title,
      message: payload.message,
      type: payload.type || 'system',
      channel: 'internal' as const,
      isRead: false,
    }))
    await this.repo.createMany(notifications)
    return { success: true, sentCount: targets.length }
  }
}
