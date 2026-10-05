import type { UserProfileFull } from '@casino/shared-types'

/** Read-модель карточки игрока живёт в @casino/shared-types (В4); тут реэкспорт
 *  для внутренних потребителей домена/application. */
export type { UserProfileFull }

export interface UserGeoContext {
  currencyPreference: string | null
  lastPaymentMethod: string | null
  country: string | null
}

/**
 * Статусы учётной записи — тот же набор, что `UserStatus` в схеме БД
 * (`@casino/shared-types`), но названный здесь без зависимости домена от
 * Prisma/enum-пакета (MODULE_TEMPLATE: domain не тянет внешние реализации).
 */
export type UserAccountStatus = 'active' | 'blocked' | 'suspended'

/**
 * Ввод создания служебной учётной записи (GAP-62).
 *
 * Поля обязательны, а не опциональны: набор служебных колонок (`email`,
 * `status`, `referral_code`) решает application-слой, и repository не должен
 * тихо подставлять дефолты вместо явного решения владельца данных.
 */
export interface CreateServiceUserInput {
  /** null — учётка без почтового ящика: email живёт в модуле-владельце контакта. */
  email: string | null
  status: UserAccountStatus
  /** Уникальный игровой реферальный код: колонка NOT NULL + @unique. */
  referralCode: string
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
  /**
   * GAP-62: создать служебную учётную запись (таблица `users` — наша).
   * Возвращает id новой строки; коллизию `@unique` (email/referral_code)
   * реализация не сглаживает — ошибка БД уходит наружу, как и до переноса.
   */
  createServiceUser(input: CreateServiceUserInput): Promise<{ id: string }>
  /**
   * GAP-62: удалить служебную учётную запись по id — компенсация сироты.
   *
   * Удаляется ТОЛЬКО строка без email: метод попадает в публичный API модуля
   * (через `UsersFacade`), и без этого условия ошибка в id могла бы снести
   * аккаунт игрока вместе с каскадными кошельком и историей.
   * Возвращает false, когда row под id нет или это не служебная запись.
   */
  deleteServiceUser(userId: string): Promise<boolean>
}

export const USER_PROFILE_REPOSITORY = Symbol('USER_PROFILE_REPOSITORY')
