/**
 * Репозиторий настроек пользователя и сессий для self-exclusion.
 * Application-слой не трогает Prisma напрямую (audit §A3/H5).
 */
export interface UserExclusionSettings {
  selfExcludedUntil: Date | null
  updatedAt: Date
}

export interface IUserSettingsRepository {
  /** Уникальные настройки пользователя (или null, если не созданы). */
  find(userId: string): Promise<UserExclusionSettings | null>
  /** Upsert с selfExcludedUntil; при создании заполняет дефолтные настройки. */
  upsertExclusion(userId: string, excludedUntil: Date): Promise<void>
  clearExclusion(userId: string): Promise<void>
  /** Отозвать все активные (не истёкшие) сессии пользователя. */
  revokeActiveSessions(userId: string): Promise<void>
}

export const USER_SETTINGS_REPOSITORY = Symbol('USER_SETTINGS_REPOSITORY')
