/**
 * Назначение исполнителя тикета (UC-SUP-admin, ТЗ ч.6).
 *
 * ВОЛНА В3: `support-admin.controller.ts` вызывал `supportRepo.assign(...)`
 * напрямую, то есть presentation-слой писал в `support_ticket`. Запись вместе с
 * правилами нормализации переехала сюда; контроллер остаётся HTTP-обёрткой.
 *
 * Пустой `adminId` означает «снять назначение» (null в колонке assignedTo) —
 * это то, что делал и прежний контроллер (`dto.admin_id || null`).
 *
 * ИЗВЕСТНЫЙ КРАЙНИЙ СЛУЧАЙ СОЗНАТЕЛЬНО ОСТАВЛЕН КАК БЫЛО: тикета нет — порт
 * бросает ошибку Prisma, и ответ остаётся 500, а не 404. Проверка
 * существования изменила бы HTTP-статус живого эндпоинта, а контракт в этой
 * волне менять нельзя; заводить 404 нужно отдельной задачей вместе с
 * `setPriority` и `setStatus` (у них та же картина).
 */
import { Inject, Injectable } from '@nestjs/common'

import {
  type ISupportRepository,
  SUPPORT_REPOSITORY,
} from '../../domain/repositories/support.repository'

@Injectable()
export class AssignTicketUseCase {
  constructor(@Inject(SUPPORT_REPOSITORY) private readonly supportRepository: ISupportRepository) {}

  async execute(input: {
    ticketId: string
    /** null — снять исполнителя. */
    adminId: string | null
  }): Promise<{ ok: boolean }> {
    await this.supportRepository.assign(input.ticketId, input.adminId)
    return { ok: true }
  }
}
