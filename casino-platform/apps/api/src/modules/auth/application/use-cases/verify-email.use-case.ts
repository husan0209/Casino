import { Inject, Injectable } from '@nestjs/common'

import { TokenInvalidError, TokenExpiredError, TokenAlreadyUsedError } from '../../domain/errors'
import {
  IEmailVerificationRepository,
  EMAIL_VERIFICATION_REPOSITORY,
  ISessionRepository,
  SESSION_REPOSITORY,
} from '../../domain/repositories'
import { IUserRepository, USER_REPOSITORY } from '../../domain/repositories/user.repository'
import { JwtTokenService } from '../../infrastructure/services/jwt.service'

@Injectable()
export class VerifyEmailUseCase {
  // eslint-disable-next-line max-params -- Nest DI: состав конструктора задаётся графом зависимостей (GAP-25)
  constructor(
    @Inject(USER_REPOSITORY) private users: IUserRepository,
    @Inject(EMAIL_VERIFICATION_REPOSITORY) private verif: IEmailVerificationRepository,
    @Inject(SESSION_REPOSITORY) private sessions: ISessionRepository,
    private jwt: JwtTokenService,
  ) {}
  async execute(token: string, ip?: string, userAgent?: string) {
    const rec = await this.verif.findByToken(token)
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
    user.markEmailVerified()
    await this.users.update(user)
    await this.verif.markUsed(rec.id)
    const { token: refreshToken, hash } = this.jwt.generateRefreshToken()
    const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000)
    const session = await this.sessions.create({
      userId: user.id,
      refreshTokenHash: hash,
      ipAddress: ip || null,
      userAgent: userAgent || null,
      expiresAt,
      revokedAt: null,
    })
    const accessToken = this.jwt.signAccess(user.id, user.role, session.id)
    return { accessToken, refreshToken, user: { id: user.id, email: user.email, role: user.role } }
  }
}
