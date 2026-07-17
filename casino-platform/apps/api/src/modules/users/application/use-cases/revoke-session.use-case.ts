import { Inject, Injectable, ForbiddenException } from '@nestjs/common'
import { IUserSessionRepository, USER_SESSION_REPOSITORY } from '../../domain/repositories/user-session.repository'
@Injectable()
export class RevokeSessionUseCase {
  constructor(@Inject(USER_SESSION_REPOSITORY) private repo: IUserSessionRepository) {}
  async execute(userId: string, sessionId: string, currentSessionId?: string) {
    if (sessionId === currentSessionId) throw new ForbiddenException('Cannot revoke current session, use logout')
    const ok = await this.repo.revoke(sessionId, userId)
    if (!ok) throw new ForbiddenException('NOT_FOUND')
    return { ok: true }
  }
}
