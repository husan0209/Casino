export interface UserProfileFull {
  user: {
    id: string
    email: string | null
    status: string
    role: string
    referralCode: string
    createdAt: Date
  }
  profile: {
    firstName: string | null
    lastName: string | null
    dateOfBirth: Date | null
    country: string | null
    city: string | null
    avatarUrl: string | null
    currencyPreference: string
    lastPaymentMethod: string | null
  } | null
  settings: {
    notificationsEmail: boolean
    notificationsPush: boolean
    language: string
    timezone: string
  } | null
  kycStatus: string
}

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
