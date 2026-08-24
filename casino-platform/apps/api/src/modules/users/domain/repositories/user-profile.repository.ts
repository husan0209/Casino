export interface UserProfileFull {
  user: { id: string; email: string | null; status: string; role: string; referralCode: string; createdAt: Date }
  profile: any | null
  settings: any | null
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
  updateProfile(userId: string, data: { firstName?: string; lastName?: string; dateOfBirth?: Date | null; country?: string; city?: string }): Promise<void>
  updateSettings(userId: string, data: { notificationsEmail?: boolean; notificationsPush?: boolean; language?: string; timezone?: string }): Promise<void>
  updateCurrencyPreference(userId: string, currency: string): Promise<void>
  updateAfterDeposit(userId: string, currency: string, method: string): Promise<void>
  setAvatar(userId: string, avatarUrl: string): Promise<void>
}

export const USER_PROFILE_REPOSITORY = Symbol('USER_PROFILE_REPOSITORY')
