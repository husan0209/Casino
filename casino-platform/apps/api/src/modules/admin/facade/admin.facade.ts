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
   * То же, что `logAction`, но сбой летит наружу.
   *
   * Нужен вызывающим, для которых строка `audit_logs` — не только наблюдаемость,
   * а состояние: например, maintenance пишет туда факт напоминания о зависшем
   * выводе и по этой же строке решает, не слать ли его повторно (дедуп по
   * `action` + `targetId` за окно). Луч-effort-вариант молчал бы о пропавшей
   * строке, и через час админ получил бы второе письмо — при живом варианте
   * падение видно в логе джобы.
   */
  logActionStrict(input: AuditLogInput): Promise<void> {
    return this.audit.log(input)
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
