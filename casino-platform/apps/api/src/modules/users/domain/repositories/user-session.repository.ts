export interface UserSessionDto {
  id: string
  ipAddress: string | null
  userAgent: string | null
  createdAt: Date
  isCurrent: boolean
}
export interface IUserSessionRepository {
  list(userId: string): Promise<Omit<UserSessionDto, 'isCurrent'>[]>
  revoke(sessionId: string, userId: string): Promise<boolean>
  /** GAP-52: «Завершить все кроме текущей» — возвращает число отозванных. */
  revokeAllExceptCurrent(userId: string, currentSessionId: string): Promise<number>
  /**
   * Удалить мёртвые сессии (`expiresAt < cutoff` ИЛИ `revokedAt < cutoff`).
   * Возвращает число удалённых строк.
   *
   * G24: чистит таблицу её владелец, а не cron из maintenance, который раньше
   * делал `prisma.session.deleteMany` напрямую. По карте `MODEL_OWNERS` у
   * `Session` два владельца: auth (выдача refresh-токенов) и users (отзыв,
   * §3.1) — уборка относится ко второй, поэтому она здесь, а не в auth, где
   * фасада под такого потребителя нет.
   */
  purgeDead(cutoff: Date): Promise<number>
}
export const USER_SESSION_REPOSITORY = Symbol('USER_SESSION_REPOSITORY')
