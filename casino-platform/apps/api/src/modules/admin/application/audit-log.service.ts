import { Inject, Injectable } from '@nestjs/common'

import {
  AUDIT_LOG_REPOSITORY,
  type AuditLogFilter,
  type AuditLogInput,
  type IAuditLogRepository,
} from '../domain/admin.repository'

import type { AuditLog } from '@prisma/client'

@Injectable()
export class AuditLogService {
  constructor(@Inject(AUDIT_LOG_REPOSITORY) private readonly repo: IAuditLogRepository) {}

  async log(input: AuditLogInput): Promise<void> {
    await this.repo.log(input)
  }

  /**
   * Журнал для админки (`GET /admin/audit-logs`). До G27 контроллер сам
   * собирал `where` по `audit_logs` и кастовал `?actor_type` к enum'у схемы,
   * поэтому мусор в фильтре давал 500 вместо 400.
   */
  async list(filter: AuditLogFilter): Promise<{ items: AuditLog[]; total: number }> {
    const [items, total] = await this.repo.list(filter)
    return { items, total }
  }
}
