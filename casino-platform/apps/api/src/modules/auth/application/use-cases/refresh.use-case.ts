import { Inject, Injectable } from '@nestjs/common'
import { ISessionRepository, SESSION_REPOSITORY } from '../../domain/repositories/session.repository'
import { IUserRepository, USER_REPOSITORY } from '../../domain/repositories/user.repository'
import { JwtTokenService } from '../../infrastructure/services/jwt.service'
import { SessionInvalidError, SessionExpiredError, AccountBlockedError } from '../../domain/errors'
@Injectable()
export class RefreshUseCase {
  constructor(
    @Inject(SESSION_REPOSITORY) private sessions: ISessionRepository,
    @Inject(USER_REPOSITORY) private users: IUserRepository,
    private jwt: JwtTokenService,
  ) {}
  async execute(refreshToken: string) {
    const hash = this.jwt.hashRefreshToken(refreshToken)
    const session = await this.sessions.findByRefreshTokenHash(hash)
    if (!session || session.revokedAt) throw new SessionInvalidError()
    if (session.expiresAt < new Date()) throw new SessionExpiredError()
    const user = await this.users.findById(session.userId)
    if (!user || user.status !== 'active') throw new AccountBlockedError()
    await this.sessions.revoke(session.id)
    const { token: newRefresh, hash: newHash } = this.jwt.generateRefreshToken()
    const expiresAt = new Date(Date.now() + 30*24*3600*1000)
    const newSession = await this.sessions.create({ userId: user.id, refreshTokenHash: newHash, ipAddress: session.ipAddress, userAgent: null, expiresAt, revokedAt: null })
    const accessToken = this.jwt.signAccess(user.id, user.role, newSession.id)
    return { accessToken, refreshToken: newRefresh }
  }
}
