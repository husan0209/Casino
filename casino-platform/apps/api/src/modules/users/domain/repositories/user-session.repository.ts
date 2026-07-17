export interface UserSessionDto { id: string; ipAddress: string | null; userAgent: string | null; createdAt: Date; isCurrent: boolean }
export interface IUserSessionRepository {
  list(userId: string): Promise<Omit<UserSessionDto,'isCurrent'>[]>
  revoke(sessionId: string, userId: string): Promise<boolean>
}
export const USER_SESSION_REPOSITORY = Symbol('USER_SESSION_REPOSITORY')
