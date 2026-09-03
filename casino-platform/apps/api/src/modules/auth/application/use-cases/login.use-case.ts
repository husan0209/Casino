import { Inject, Injectable } from '@nestjs/common'

import { type LockoutConfig, type UserRole } from '../../domain/entities/user.entity'
import { AccountBlockedError, AccountLockedError, InvalidCredentialsError, SelfExcludedError } from '../../domain/errors'
import { type ISessionRepository, SESSION_REPOSITORY } from '../../domain/repositories/session.repository'
import { type IUserSettingsRepository, USER_SETTINGS_REPOSITORY } from '../../domain/repositories/user-settings.repository'
import { type IUserRepository, USER_REPOSITORY } from '../../domain/repositories/user.repository'
import { type JwtTokenService } from '../../infrastructure/services/jwt.service'
import { type PasswordHasher } from '../../infrastructure/services/password-hasher.service'

@Injectable()
export class LoginUseCase {
  // GAP-18: 10 неудач за 15 минут → блок на 30 минут (SECURITY_BASELINE §2.2).
  private readonly lockout: LockoutConfig = {
    maxAttempts: Number(process.env['LOCKOUT_MAX_ATTEMPTS'] ?? 10),
    windowMs: Number(process.env['LOCKOUT_WINDOW_MS'] ?? 15 * 60_000),
    lockDurationMs: Number(process.env['LOCKOUT_DURATION_MS'] ?? 30 * 60_000),
  }

  // eslint-disable-next-line max-params -- Nest DI: состав конструктора задаётся графом зависимостей (GAP-25)
  constructor(
    @Inject(USER_REPOSITORY) private users: IUserRepository,
    @Inject(SESSION_REPOSITORY) private sessions: ISessionRepository,
    @Inject(USER_SETTINGS_REPOSITORY) private userSettings: IUserSettingsRepository,
    private hasher: PasswordHasher,
    private jwt: JwtTokenService,
  ) {}
  async execute(input: {
    email: string
    password: string
    ip?: string | undefined
    userAgent?: string | undefined
  }): Promise<{ accessToken: string; refreshToken: string; user: { id: string; email: string | null; role: UserRole; }; }> {
    const now = new Date()
    const user = await this.users.findByEmail(input.email.toLowerCase().trim())
    if (!user?.passwordHash) {
      throw new InvalidCredentialsError()
    }
    const ok = await this.hasher.verify(user.passwordHash, input.password)

    // Проверка блокировки ПОСЛЕ verify, чтобы не раскрывать существование аккаунта:
    // неверный пароль → всегда INVALID_CREDENTIALS (заблокирован аккаунт или нет).
    if (user.isLocked(now)) {
      if (ok) {
        throw new AccountLockedError(user.props.lockedUntil as Date)
      }
      // Уже заблокирован — счётчик не продлеваем (DoS-вектор через чужие лог-ины).
      throw new InvalidCredentialsError()
    }
    if (!ok) {
      user.registerFailedAttempt(this.lockout, now)
      await this.users.update(user)
      throw new InvalidCredentialsError()
    }

    // Email verification не блокирует вход — требуется позже для вывода (tz-part-5 §5.1)
    if (user.status !== 'active') {
      throw new AccountBlockedError()
    }

    // Self-exclusion gate — check AFTER password validation to avoid leaking user existence.
    const exclusion = await this.userSettings.findSelfExclusion(user.id)
    if (exclusion) {
      throw new SelfExcludedError(exclusion.excludedUntil)
    }

    user.resetFailedAttempts()
    user.markLogin()
    await this.users.update(user)
    const { token: refreshToken, hash } = this.jwt.generateRefreshToken()
    const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000)
    const session = await this.sessions.create({
      userId: user.id,
      refreshTokenHash: hash,
      ipAddress: input.ip || null,
      userAgent: input.userAgent || null,
      expiresAt,
      revokedAt: null,
    })
    const accessToken = this.jwt.signAccess(user.id, user.role, session.id)
    return { accessToken, refreshToken, user: { id: user.id, email: user.email, role: user.role } }
  }
}
