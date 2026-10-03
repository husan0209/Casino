/**
 * Полная карточка игрока (user + profile + settings + kycStatus) — read-модель
 * эндпоинта `GET /users/me`.
 *
 * В4: row-типы ответов API живут в shared-types, а не в домене модуля: их
 * форма — HTTP-контракт, и её меняют вместе с контрактом, а не с доменом.
 */
export interface UserProfileFull {
  user: {
    id: string
    email: string | null
    status: string
    role: string
    referralCode: string
    createdAt: Date
    /** GAP-52: true — есть password_hash (email-аккаунт); false — OAuth-only. Фронт прячет форму смены пароля. */
    hasPassword: boolean
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
