import { Controller, Get, Inject, Query, UseGuards, UsePipes } from '@nestjs/common'

import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe'

import { type AuditLog } from '@casino/database'

import { AuditLogService } from '../../application/audit-log.service'
import { AdminAuthGuard } from '../admin-auth.guard'
import { AuditListQuerySchema, type AuditListQueryDto } from '../dto/admin-audit.dto'

/**
 * Журнал действий (`GET /admin/audit-logs`) — только сериализация.
 *
 * Запрос таблицы `audit_logs` отдаёт владелец таблицы (гард G27): контроллер
 * больше не собирает `where` и не кастует query-параметры к enum'ам схемы —
 * форму проверяет Zod-схема.
 */
@UseGuards(AdminAuthGuard)
@Controller('admin/audit-logs')
export class AdminAuditController {
  constructor(@Inject(AuditLogService) private readonly audit: AuditLogService) {}

  @Get()
  @UsePipes(new ZodValidationPipe(AuditListQuerySchema))
  async list(@Query() q: AuditListQueryDto): Promise<{
    items: AuditLog[]
    meta: { page: number; perPage: number; total: number }
  }> {
    const { items, total } = await this.audit.list({
      actorType: q.actor_type,
      actorId: q.actor_id,
      action: q.action,
      targetType: q.target_type,
      page: q.page,
      perPage: q.per_page,
    })
    return { items, meta: { page: q.page, perPage: q.per_page, total } }
  }
}
