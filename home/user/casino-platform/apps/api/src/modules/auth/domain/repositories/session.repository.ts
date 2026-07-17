export interface SessionRecord {
  id: string
  userId: string
  refreshTokenHash: string
  ipAddress: string | null
  userAgent: string | null
  expiresAt: Date
  revokedAt: Date | null
  createdAt: Date
}
export interface ISessionRepository {
  create(data: Omit<SessionRecord,'id'|'createdAt'>): Promise<SessionRecord>
  findByRefreshTokenHash(hash: string): Promise<SessionRecord | null>
  revoke(id: string): Promise<void>
  revokeAllUserSessions(userId: string): Promise<void>
}
export const SESSION_REPOSITORY = Symbol('SESSION_REPOSITORY')
