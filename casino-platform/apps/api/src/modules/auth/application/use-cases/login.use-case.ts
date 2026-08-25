import { Inject, Injectable } from '@nestjs/common'
import { IUserRepository, USER_REPOSITORY } from '../../domain/repositories/user.repository'
import { ISessionRepository, SESSION_REPOSITORY } from '../../domain/repositories/session.repository'
import { IUserSettingsRepository, USER_SETTINGS_REPOSITORY } from '../../domain/repositories/user-settings.repository'
import { PasswordHasher } from '../../infrastructure/services/password-hasher.service'
import { JwtTokenService } from '../../infrastructure/services/jwt.service'
import { InvalidCredentialsError, AccountBlockedError, SelfExcludedError } from '../../domain/errors'

@Injectable()
export class LoginUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private users: IUserRepository,
    @Inject(SESSION_REPOSITORY) private sessions: ISessionRepository,
    @Inject(USER_SETTINGS_REPOSITORY) private userSettings: IUserSettingsRepository,
    private hasher: PasswordHasher,
    private jwt: JwtTokenService,
  ) {}
  async execute(input: { email: string; password: string; ip?: string | undefined; userAgent?: string | undefined }) {
    const user = await this.users.findByEmail(input.email.toLowerCase().trim())
    if (!user || !user.passwordHash) throw new InvalidCredentialsError()
    const ok = await this.hasher.verify(user.passwordHash, input.password)
    if (!ok) throw new InvalidCredentialsError()
    // Email verification не блокирует вход — требуется позже для вывода (tz-part-5 §5.1)
    if (user.status !== 'active') throw new AccountBlockedError()

    // Self-exclusion gate — check AFTER password validation to avoid leaking user existence.
    const exclusion = await this.userSettings.findSelfExclusion(user.id)
    if (exclusion) throw new SelfExcludedError(exclusion.excludedUntil)

    user.markLogin()
    await this.users.update(user)
    const { token: refreshToken, hash } = this.jwt.generateRefreshToken()
    const expiresAt = new Date(Date.now() + 30*24*3600*1000)
    const session = await this.sessions.create({ userId: user.id, refreshTokenHash: hash, ipAddress: input.ip || null, userAgent: input.userAgent || null, expiresAt, revokedAt: null })
    const accessToken = this.jwt.signAccess(user.id, user.role, session.id)
    return { accessToken, refreshToken, user: { id: user.id, email: user.email, role: user.role } }
  }
}
