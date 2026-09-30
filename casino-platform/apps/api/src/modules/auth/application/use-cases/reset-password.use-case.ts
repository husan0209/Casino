import { Inject, Injectable } from '@nestjs/common'

import { type IPasswordHasher, PASSWORD_HASHER } from '../../domain/auth.ports'
import {
  TokenInvalidError,
  TokenExpiredError,
  TokenAlreadyUsedError,
  WeakPasswordError,
} from '../../domain/errors'
import {
  type IPasswordResetRepository,
  PASSWORD_RESET_REPOSITORY,
  type ISessionRepository,
  SESSION_REPOSITORY,
} from '../../domain/repositories'
import { type IUserRepository, USER_REPOSITORY } from '../../domain/repositories/user.repository'

@Injectable()
export class ResetPasswordUseCase {
  // eslint-disable-next-line max-params -- Nest DI: состав конструктора задаётся графом зависимостей (GAP-25)
  constructor(
    @Inject(PASSWORD_RESET_REPOSITORY) private resets: IPasswordResetRepository,
    @Inject(USER_REPOSITORY) private users: IUserRepository,
    @Inject(SESSION_REPOSITORY) private sessions: ISessionRepository,
    @Inject(PASSWORD_HASHER) private hasher: IPasswordHasher,
  ) {}
  async execute(token: string, newPassword: string): Promise<{ ok: boolean }> {
    if (newPassword.length < 8) {
      throw new WeakPasswordError()
    }
    const rec = await this.resets.findByToken(token)
    if (!rec) {
      throw new TokenInvalidError()
    }
    if (rec.usedAt) {
      throw new TokenAlreadyUsedError()
    }
    if (rec.expiresAt < new Date()) {
      throw new TokenExpiredError()
    }
    const user = await this.users.findById(rec.userId)
    if (!user) {
      throw new TokenInvalidError()
    }
    const hash = await this.hasher.hash(newPassword)
    user.setPasswordHash(hash)
    await this.users.update(user)
    await this.resets.markUsed(rec.id)
    await this.sessions.revokeAllUserSessions(user.id)
    return { ok: true }
  }
}
