import { Inject, Injectable, Logger } from '@nestjs/common'

import { AdminSettingsService } from '../application/admin-settings.service'
import { AuditLogService } from '../application/audit-log.service'
import { type AuditLogInput } from '../domain/admin.repository'
import { type SystemSettingRow } from '../domain/system.repository'

/**
 * Публичный API admin-модуля (MODULE_TEMPLATE Шаг 8).
 *
 * Существует ради единого правила: межмодульный доступ — только через фасад
 * (AGENTS.md правило 4). Импорт `AuditLogService` из `admin/application`
 * снаружи считается межмодульным долгом и фиксируется гвардом G16
 * (`pnpm --filter @casino/api exec sh scripts/bin/tech-debt check
 * cross-module-imports`).
 *
 * Сейчас через фасад пишет модуль affiliate: смена ставки, статуса и
 * настроек партнёра обязана попадать в `audit_logs` (ТЗ ч.8 §14.1), а
 * значения настроек программы — в `system_settings`, чей владелец — admin
 * (карта `MODEL_OWNERS`, гард G24; GAP-62).
 */
@Injectable()
export class AdminFacade {
  private readonly logger = new Logger(AdminFacade.name)

  constructor(
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(AdminSettingsService) private readonly settings: AdminSettingsService,
  ) {}

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

  /**
   * Записать настройку в `system_settings`.
   *
   * Таблица принадлежит admin (MODEL_OWNERS), поэтому чужой модуль, которому
   * нужно сохранить свой ключ настроек, идёт отсюда, а не через `prisma`:
   * иначе правила ключа, `category` для админ-UI и будущая валидация живут
   * в двух местах и расходятся молча.
   */
  setSystemSetting(input: {
    key: string
    value: string
    type: SystemSettingRow['type']
    updatedBy: string
    category?: string | undefined
  }): Promise<SystemSettingRow> {
    return this.settings.upsert(input)
  }
}
