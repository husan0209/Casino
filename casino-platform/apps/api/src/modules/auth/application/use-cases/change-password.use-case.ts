import { Inject, Injectable } from '@nestjs/common'

import { InvalidCredentialsError, PasswordNotSetError, WeakPasswordError } from '../../domain/errors'
import { ISessionRepository, SESSION_REPOSITORY } from '../../domain/repositories/session.repository'
import { IUserRepository, USER_REPOSITORY } from '../../domain/repositories/user.repository'
import { PasswordHasher } from '../../infrastructure/services/password-hasher.service'

/**
 * GAP-52 (ТЗ ч.5 §9 «Безопасность»): смена пароля из профиля залогиненным
 * пользователем. Требует текущий пароль; после смены все сессии, кроме
 * текущей, отзываются (как в UC-AUTH-07 reset-password, но текущая сессия
 * живёт — иначе UI разлогинится сам себя без объяснения).
 */
@Injectable()
export class ChangePasswordUseCase {
  // eslint-disable-next-line max-params -- Nest DI: состав конструктора задаётся графом зависимостей (GAP-25)
  constructor(
    @Inject(USER_REPOSITORY) private users: IUserRepository,
    @Inject(SESSION_REPOSITORY) private sessions: ISessionRepository,
    private hasher: PasswordHasher,
  ) {}

  async execute(input: {
    userId: string
    currentPassword: string
    newPassword: string
    currentSessionId: string
  }): Promise<{ ok: boolean }> {
    if (input.newPassword.length < 8) {
      throw new WeakPasswordError()
    }
    const user = await this.users.findById(input.userId)
    if (!user?.passwordHash) {
      // OAuth-аккаунт без пароля: фронт не должен показывать форму (hasPassword
      // в /users/me), но и API не молчит — явный код вместо INVALID_CREDENTIALS.
      throw new PasswordNotSetError()
    }
    const currentOk = await this.hasher.verify(user.passwordHash, input.currentPassword)
    if (!currentOk) {
      throw new InvalidCredentialsError()
    }
    const newHash = await this.hasher.hash(input.newPassword)
    user.setPasswordHash(newHash)
    await this.users.update(user)
    await this.sessions.revokeAllUserSessionsExcept(input.userId, input.currentSessionId)
    return { ok: true }
  }
}
