import { Inject, Injectable } from '@nestjs/common'

import { type IJwtTokenService, JWT_TOKEN_SERVICE } from '../../domain/auth.ports'
import { SessionInvalidError, SessionExpiredError, AccountBlockedError } from '../../domain/errors'
import {
  type ISessionRepository,
  SESSION_REPOSITORY,
} from '../../domain/repositories/session.repository'
import { type IUserRepository, USER_REPOSITORY } from '../../domain/repositories/user.repository'

@Injectable()
export class RefreshUseCase {
  constructor(
    @Inject(SESSION_REPOSITORY) private sessions: ISessionRepository,
    @Inject(USER_REPOSITORY) private users: IUserRepository,
    @Inject(JWT_TOKEN_SERVICE) private jwt: IJwtTokenService,
  ) {}
  async execute(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const hash = this.jwt.hashRefreshToken(refreshToken)
    const session = await this.sessions.findByRefreshTokenHash(hash)
    if (!session || session.revokedAt) {
      throw new SessionInvalidError()
    }
    if (session.expiresAt < new Date()) {
      throw new SessionExpiredError()
    }
    const user = await this.users.findById(session.userId)
    if (user?.status !== 'active') {
      throw new AccountBlockedError()
    }
    await this.sessions.revoke(session.id)
    const { token: newRefresh, hash: newHash } = this.jwt.generateRefreshToken()
    const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000)
    const newSession = await this.sessions.create({
      userId: user.id,
      refreshTokenHash: newHash,
      ipAddress: session.ipAddress,
      userAgent: null,
      expiresAt,
      revokedAt: null,
    })
    const accessToken = this.jwt.signAccess(user.id, user.role, newSession.id)
    return { accessToken, refreshToken: newRefresh }
  }
}
