import { Inject, Injectable } from '@nestjs/common'

import {
  IUserSessionRepository,
  USER_SESSION_REPOSITORY,
} from '../../domain/repositories/user-session.repository'

/**
 * GAP-52 (ТЗ ч.5 §9 «Сессии»: «завершить одну / все кроме текущей»).
 * Текущую сессию не трогаем — иначе пользователь разлогинится сам собой.
 */
@Injectable()
export class RevokeAllSessionsUseCase {
  constructor(@Inject(USER_SESSION_REPOSITORY) private repo: IUserSessionRepository) {}
  async execute(userId: string, currentSessionId: string): Promise<{ ok: boolean; revoked: number }> {
    const revoked = await this.repo.revokeAllExceptCurrent(userId, currentSessionId)
    return { ok: true, revoked }
  }
}
