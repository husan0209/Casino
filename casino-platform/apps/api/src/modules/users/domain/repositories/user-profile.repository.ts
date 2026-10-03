import type { UserProfileFull } from '@casino/shared-types'

/** Read-модель карточки игрока живёт в @casino/shared-types (В4); тут реэкспорт
 *  для внутренних потребителей домена/application. */
export type { UserProfileFull }

export interface UserGeoContext {
  currencyPreference: string | null
  lastPaymentMethod: string | null
  country: string | null
}

export interface IUserProfileRepository {
  getMe(userId: string): Promise<UserProfileFull | null>
  getGeoContext(userId: string): Promise<UserGeoContext | null>
  updateProfile(
    userId: string,
    data: {
      firstName?: string | undefined
      lastName?: string | undefined
      dateOfBirth?: Date | null | undefined
      country?: string | undefined
      city?: string | undefined
    },
  ): Promise<void>
  updateSettings(
    userId: string,
    data: {
      notificationsEmail?: boolean
      notificationsPush?: boolean
      language?: string
      timezone?: string
    },
  ): Promise<void>
  updateCurrencyPreference(userId: string, currency: string): Promise<void>
  updateAfterDeposit(userId: string, currency: string, method: string): Promise<void>
  setAvatar(userId: string, avatarUrl: string): Promise<void>
}

export const USER_PROFILE_REPOSITORY = Symbol('USER_PROFILE_REPOSITORY')
