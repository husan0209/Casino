/**
 * Смена приоритета тикета (UC-SUP-admin, ТЗ ч.6).
 *
 * ВОЛНА В3: запись делал `support-admin.controller.ts` через
 * `supportRepo.setPriority` — прямой доступ к БД из presentation. Перенесено
 * сюда вместе с проверкой допустимого значения.
 *
 * ПРИОРИТЕТ ПРОВЕРЯЕТСЯ ЗДЕСЬ, А НЕ ТОЛЬКО Zod-схемой: через HTTP значение и
 * так отсекает `SetPrioritySchema` (400 от BadRequestException), но use case
 * могут вызвать не только из контроллера (job, консольная команда), а
 * невалидный приоритет — данные, которые видит регулятор. Через эндпоинт эта
 * ветка недостижима, поэтому HTTP-статусы не меняются.
 */
import { Inject, Injectable } from '@nestjs/common'

import { InvalidTicketPriorityError } from '../../domain/errors'
import {
  type ISupportRepository,
  SUPPORT_REPOSITORY,
  type TicketPriority,
} from '../../domain/repositories/support.repository'

/** Закрытый справочник приоритетов — то же множество, что у TicketPriority. */
const ALLOWED_PRIORITIES: readonly TicketPriority[] = ['low', 'normal', 'high', 'urgent']

@Injectable()
export class SetTicketPriorityUseCase {
  constructor(@Inject(SUPPORT_REPOSITORY) private readonly supportRepository: ISupportRepository) {}

  async execute(input: { ticketId: string; priority: TicketPriority }): Promise<{ ok: boolean }> {
    if (!ALLOWED_PRIORITIES.includes(input.priority)) {
      throw new InvalidTicketPriorityError(input.priority)
    }
    await this.supportRepository.setPriority(input.ticketId, input.priority)
    return { ok: true }
  }
}
