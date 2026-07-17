import { Inject, Injectable } from '@nestjs/common'
import { ISessionRepository, SESSION_REPOSITORY } from '../../domain/repositories/session.repository'
@Injectable()
export class LogoutUseCase {
  constructor(@Inject(SESSION_REPOSITORY) private sessions: ISessionRepository) {}
  async execute(sessionId: string) { await this.sessions.revoke(sessionId); return { ok: true } }
}
