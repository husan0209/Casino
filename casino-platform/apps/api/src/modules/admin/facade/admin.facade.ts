import { Inject, Injectable, Logger } from '@nestjs/common'

import { AuditLogService } from '../application/audit-log.service'
import { type AuditLogInput } from '../domain/admin.repository'

/**
 * Публичный API admin-модуля (MODULE_TEMPLATE Шаг 8).
 *
 * Существует ради единого правила: межмодульный доступ — только через фасад
 * (AGENTS.md правило 4). Импорт `AuditLogService` из `admin/application`
 * снаружи считается межмодульным долгом и фиксируется гвардом G16
 * (`pnpm --filter @casino/api exec sh scripts/bin/tech-debt check
 * cross-module-imports`).
 *
 * Сейчас через фасад пишет аудит модуль affiliate: смена ставки, статуса и
 * настроек партнёра обязана попадать в `audit_logs` (ТЗ ч.8 §14.1).
 */
@Injectable()
export class AdminFacade {
  private readonly logger = new Logger(AdminFacade.name)

  constructor(@Inject(AuditLogService) private readonly audit: AuditLogService) {}

  /**
   * Записать действие администратора в журнал аудита.
   *
   * Ошибка не должна ломать саму операцию: аудит — observability, а не
   * часть бизнес-транзакции. Поэтому сбой логируется и не пробрасывается.
   */
  async logAction(input: AuditLogInput): Promise<void> {
    try {
      await this.audit.log(input)
    } catch (error) {
      this.logger.error(
        `Audit log write failed: action=${input.action} target=${input.targetType ?? '-'}`,
        error instanceof Error ? error.stack : undefined,
      )
    }
  }
}
