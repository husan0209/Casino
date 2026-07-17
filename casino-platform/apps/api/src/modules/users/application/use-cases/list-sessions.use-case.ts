import { Inject, Injectable } from '@nestjs/common'
import { IUserSessionRepository, USER_SESSION_REPOSITORY } from '../../domain/repositories/user-session.repository'
@Injectable()
export class ListSessionsUseCase {
  constructor(@Inject(USER_SESSION_REPOSITORY) private repo: IUserSessionRepository) {}
  async execute(userId: string, currentSessionId?: string) {
    const list = await this.repo.list(userId)
    return list.map(s => ({ ...s, isCurrent: s.id === currentSessionId }))
  }
}
