import { Inject, Injectable } from '@nestjs/common'
import { IUserRepository, USER_REPOSITORY } from '../../domain/repositories/user.repository'
import { IPasswordResetRepository, PASSWORD_RESET_REPOSITORY, ISessionRepository, SESSION_REPOSITORY } from '../../domain/repositories'
import { PasswordHasher } from '../../infrastructure/services/password-hasher.service'
import { TokenInvalidError, TokenExpiredError, TokenAlreadyUsedError, WeakPasswordError } from '../../domain/errors'
@Injectable()
export class ResetPasswordUseCase {
  constructor(
    @Inject(PASSWORD_RESET_REPOSITORY) private resets: IPasswordResetRepository,
    @Inject(USER_REPOSITORY) private users: IUserRepository,
    @Inject(SESSION_REPOSITORY) private sessions: ISessionRepository,
    private hasher: PasswordHasher,
  ) {}
  async execute(token: string, newPassword: string) {
    if (newPassword.length < 8) throw new WeakPasswordError()
    const rec = await this.resets.findByToken(token)
    if (!rec) throw new TokenInvalidError()
    if (rec.usedAt) throw new TokenAlreadyUsedError()
    if (rec.expiresAt < new Date()) throw new TokenExpiredError()
    const user = await this.users.findById(rec.userId)
    if (!user) throw new TokenInvalidError()
    const hash = await this.hasher.hash(newPassword)
    user.setPasswordHash(hash)
    await this.users.update(user)
    await this.resets.markUsed(rec.id)
    await this.sessions.revokeAllUserSessions(user.id)
    return { ok: true }
  }
}
