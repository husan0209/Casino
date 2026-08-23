export interface SessionCreateInput {
  userId: string
  refreshTokenHash: string
  ipAddress: string | null
  userAgent: string | null
  expiresAt: Date
  revokedAt: Date | null
}

export interface SessionView {
  id: string
  userId: string
  refreshTokenHash: string
  ipAddress: string | null
  userAgent: string | null
  expiresAt: Date
  revokedAt: Date | null
}

export interface ISessionRepository {
  create(input: SessionCreateInput): Promise<SessionView>
  findByRefreshTokenHash(hash: string): Promise<SessionView | null>
  revoke(id: string): Promise<void>
  revokeAllUserSessions(userId: string): Promise<void>
}

export const SESSION_REPOSITORY = Symbol('SESSION_REPOSITORY')
