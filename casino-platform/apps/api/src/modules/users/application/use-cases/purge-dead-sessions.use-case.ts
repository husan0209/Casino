/**
 * Уборка мёртвых сессий (G24): таблицы `sessions` касается её владелец.
 *
 * До переезда `maintenance` сам делал `prisma.session.deleteMany` — cron лез в
 * чужую таблицу, а условие «что считать мёртвой» жило не рядом с данными.
 * Здесь остаётся только порядок: какой cutoff выбран (grace-окно, чтобы
 * admin-UI ещё видел недавние «выходы») решает job, удаление — этот use case.
 */
import { Inject, Injectable } from '@nestjs/common'

import {
  type IUserSessionRepository,
  USER_SESSION_REPOSITORY,
} from '../../domain/repositories/user-session.repository'

@Injectable()
export class PurgeDeadSessionsUseCase {
  constructor(@Inject(USER_SESSION_REPOSITORY) private readonly sessions: IUserSessionRepository) {}

  /** Возвращает число удалённых строк — job логирует его как `purged`. */
  execute(cutoff: Date): Promise<number> {
    return this.sessions.purgeDead(cutoff)
  }
}
