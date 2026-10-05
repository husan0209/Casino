/**
 * Публичный API notifications-модуля (MODULE_TEMPLATE Шаг 8).
 *
 * Существует ради одного правила: межмодульный доступ — только через фасад
 * (AGENTS.md правило 4). До него админская рассылка писала в `notifications`
 * сама (`prisma.notification.createMany` из `admin/infrastructure`), то есть
 * второй владелец формата уведомления жил не в модуле уведомлений — поле
 * `channel`, default `data` и правило `isRead` можно было рассинхронизировать
 * молча. Гард G24 (`tech-debt check foreign-writes`) считал это долгом.
 */
import { Inject, Injectable } from '@nestjs/common'

import { NotificationService } from '../application/notification.service'
import { type BroadcastNotificationInput } from '../domain/notification.repository'

@Injectable()
export class NotificationsFacade {
  constructor(@Inject(NotificationService) private readonly service: NotificationService) {}

  /**
   * Внутренняя рассылка одним запросом. Возвращает число созданных уведомлений —
   * вызывающий отдаёт его оператору как `sentCount`, не как длину своего списка.
   */
  broadcastInternal(rows: BroadcastNotificationInput[]): Promise<number> {
    return this.service.broadcast(rows)
  }
}
