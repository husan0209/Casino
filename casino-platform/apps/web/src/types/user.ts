/**
 * DTO профиля пользователя (контракт GET /users/me).
 * Форма соответствует GetMeUseCase -> UserProfileFull (camelCase как в API).
 */

/** Ответ GET /users/me. */
export interface MeDto {
  user: {
    id: string
    email: string | null
    status: string
    role: string
    referralCode: string
    createdAt: string
  }
  profile: {
    firstName: string | null
    lastName: string | null
    dateOfBirth: string | null
    country: string | null
    city: string | null
    avatarUrl: string | null
    currencyPreference: string
  } | null
  settings: {
    notificationsEmail: boolean
    notificationsPush: boolean
    language: string
    timezone: string
  } | null
  kycStatus: string
}
