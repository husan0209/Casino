/**
 * Returns the active self-exclusion window for a user, if any.
 * Returns null if the user has no settings row or the exclusion has expired.
 */
export interface SelfExclusionStatus {
  excludedUntil: Date
}

export interface IUserSettingsRepository {
  findSelfExclusion(userId: string): Promise<SelfExclusionStatus | null>
}

export const USER_SETTINGS_REPOSITORY = Symbol('USER_SETTINGS_REPOSITORY')
