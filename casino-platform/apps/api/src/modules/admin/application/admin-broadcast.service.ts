import { Inject, Injectable } from '@nestjs/common'

import { NotificationsFacade } from '@modules/notifications/facade/notifications.facade'

import {
  type IAdminBroadcastRepository,
  ADMIN_BROADCAST_REPOSITORY,
} from '../domain/system.repository'

/**
 * Массовая рассылка уведомлений (В3: prisma-direct вынесен из контроллера).
 *
 * Адресатов считает admin (своё чтение `users` по ADR GAP-51), саму запись
 * делает владелец таблицы `notifications` через фасад (гард G24). `sentCount`
 * — ответ из БД о вставленных строках, а не длина списка адресатов: если
 * вставилось меньше, оператор обязан увидеть это число, а не «всем ушло».
 */
@Injectable()
export class AdminBroadcastService {
  constructor(
    @Inject(ADMIN_BROADCAST_REPOSITORY) private readonly repo: IAdminBroadcastRepository,
    @Inject(NotificationsFacade) private readonly notifications: NotificationsFacade,
  ) {}

  async send(
    userIds: string[],
    payload: { title: string; message: string; type: string },
  ): Promise<{ success: boolean; sentCount: number }> {
    let targets = userIds
    if (targets.length === 0) {
      targets = await this.repo.getAllUserIds()
    }
    const created = await this.notifications.broadcastInternal(
      targets.map((userId) => ({
        userId,
        type: payload.type || 'system',
        title: payload.title,
        message: payload.message,
      })),
    )
    return { success: true, sentCount: created }
  }
}
