import { Inject, Injectable, Logger } from '@nestjs/common'

import {
  SESSION_MAINTENANCE_REPO,
  type ISessionMaintenanceRepo,
} from '../domain/maintenance.ports'

/**
 * Job `cleanup-sessions` (pre-launch hardening A1, 2026-09-04): удаляет мёртвые
 * сессии из таблицы `sessions`, которая иначе растёт бесконечно — expired и
 * отозванные строки никогда не удалялись, lookup по refreshTokenHash при каждом
 * логине ходил по распухающей таблице.
 *
 * Что удаляется: сессии с `expiresAt < cutoff` ИЛИ `revokedAt < cutoff`
 * (grace 7 дней после отзыва — чтобы admin-UI ещё показывал недавние
 * «выходы со всех устройств» и не сломать already-revoked-проверку при
 * конкурирующем refresh).
 *
 * Идемпотентен: delete по условию; повторный запуск удаляет 0.
 * Расписание — JOB_CLEANUP_SESSIONS_EVERY_MS (default 1 час).
 */
@Injectable()
export class CleanupSessionsJob {
  private readonly logger = new Logger(CleanupSessionsJob.name)

  constructor(
    @Inject(SESSION_MAINTENANCE_REPO) private readonly repo: ISessionMaintenanceRepo,
  ) {}

  async execute(now = new Date()): Promise<{ purged: number }> {
    const cutoff = new Date(now.getTime() - 7 * 24 * 3_600_000)
    const purged = await this.repo.purgeDeadSessions(cutoff)
    this.logger.log(`cleanup-sessions: purged=${purged}`)
    return { purged }
  }
}
