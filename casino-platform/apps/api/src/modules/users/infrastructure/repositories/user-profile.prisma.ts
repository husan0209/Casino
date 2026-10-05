import { Injectable } from '@nestjs/common'

type ProfileUpdateFields = {
  firstName?: string | undefined
  lastName?: string | undefined
  dateOfBirth?: Date | undefined
  country?: string | undefined
  city?: string | undefined
}

import { prisma, type Prisma } from '@casino/database'

import {
  type CreateServiceUserInput,
  type IUserProfileRepository,
  type UserProfileFull,
  type UserGeoContext,
} from '../../domain/repositories/user-profile.repository'

@Injectable()
export class PrismaUserProfileRepository implements IUserProfileRepository {
  async getMe(userId: string): Promise<UserProfileFull | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true, settings: true, kycProfile: true },
    })
    if (!user) {
      return null
    }
    return {
      user: {
        id: user.id,
        email: user.email,
        status: user.status,
        role: user.role,
        referralCode: user.referralCode,
        createdAt: user.createdAt,
        hasPassword: user.passwordHash !== null,
      },
      profile: user.profile,
      settings: user.settings,
      kycStatus: user.kycProfile?.status ?? 'not_started',
    }
  }

  async getGeoContext(userId: string): Promise<UserGeoContext | null> {
    const profile = await prisma.userProfile.findUnique({
      where: { userId },
      select: { currencyPreference: true, lastPaymentMethod: true, country: true },
    })
    if (!profile) {
      return null
    }
    return {
      currencyPreference: profile.currencyPreference,
      lastPaymentMethod: profile.lastPaymentMethod,
      country: profile.country,
    }
  }

  async updateCurrencyPreference(userId: string, currency: string): Promise<void> {
    await prisma.userProfile.upsert({
      where: { userId },
      update: { currencyPreference: currency },
      create: { userId, currencyPreference: currency },
    })
  }

  async updateAfterDeposit(userId: string, currency: string, method: string): Promise<void> {
    await prisma.userProfile.upsert({
      where: { userId },
      update: { lastPaymentMethod: method, currencyPreference: currency },
      create: { userId, lastPaymentMethod: method, currencyPreference: currency },
    })
  }
  async updateProfile(
    userId: string,
    data: {
      firstName?: string | undefined
      lastName?: string | undefined
      dateOfBirth?: Date | undefined
      country?: string | undefined
      city?: string | undefined
    },
  ): Promise<void> {
    await prisma.userProfile.upsert({
      where: { userId },
      // exactOptionalPropertyTypes: включаем только заданные поля
      update: this.profileUpdateData(data),
      create: this.profileCreateData(data, userId),
    })
  }

  private profileUpdateData(data: ProfileUpdateFields): Prisma.UserProfileUpdateInput {
    return {
      ...(data.firstName !== undefined && { firstName: data.firstName }),
      ...(data.lastName !== undefined && { lastName: data.lastName }),
      ...(data.dateOfBirth !== undefined && { dateOfBirth: data.dateOfBirth }),
      ...(data.country !== undefined && { country: data.country }),
      ...(data.city !== undefined && { city: data.city }),
    }
  }

  private profileCreateData(
    data: ProfileUpdateFields,
    userId: string,
  ): Prisma.UserProfileUncheckedCreateInput {
    return {
      userId,
      firstName: data.firstName ?? null,
      lastName: data.lastName ?? null,
      dateOfBirth: data.dateOfBirth ?? null,
      country: data.country ?? null,
      city: data.city ?? null,
    }
  }
  async updateSettings(
    userId: string,
    data: {
      notificationsEmail?: boolean | undefined
      notificationsPush?: boolean | undefined
      language?: string | undefined
      timezone?: string | undefined
    },
  ): Promise<void> {
    await prisma.userSettings.upsert({
      where: { userId },
      update: {
        ...(data.notificationsEmail !== undefined && {
          notificationsEmail: data.notificationsEmail,
        }),
        ...(data.notificationsPush !== undefined && { notificationsPush: data.notificationsPush }),
        ...(data.language !== undefined && { language: data.language }),
        ...(data.timezone !== undefined && { timezone: data.timezone }),
      },
      create: {
        userId,
        notificationsEmail: data.notificationsEmail ?? true,
        notificationsPush: data.notificationsPush ?? true,
        language: data.language ?? 'ru',
        timezone: data.timezone ?? 'Europe/Moscow',
      },
    })
  }
  async setAvatar(userId: string, avatarUrl: string): Promise<void> {
    await prisma.userProfile.upsert({
      where: { userId },
      update: { avatarUrl },
      create: { userId, avatarUrl },
    })
  }

  /**
   * GAP-62: служебная учётная запись создаётся здесь, а не в модуле-потребителе.
   *
   * Колонки берёт из input без «улучшений»: решение «email = null, status =
   * 'active'» принимает application-слой (`ProvisionAffiliatePlayerUseCase`),
   * инфраструктура лишь кладёт их в строку. Никаких `authProviders`: у
   * служебной записи нет способа входа (пароль партнёра живёт в
   * `affiliates.password_hash`), а `passwordHash` остаётся NULL — как и было,
   * когда INSERT делал affiliate.
   */
  async createServiceUser(input: CreateServiceUserInput): Promise<{ id: string }> {
    const user = await prisma.user.create({
      data: {
        email: input.email,
        status: input.status,
        referralCode: input.referralCode,
      },
      select: { id: true },
    })
    return user
  }

  /**
   * GAP-62: compensate-удаление сироты.
   *
   * `deleteMany` с условием `email: null`, а не `delete({ id })`: `delete`
   * бросил бы P2025 на уже отсутствующей строке и, главное, удалял бы ЛЮБУЮ
   * учётную запись по id — включая аккаунт игрока, на котором каскадом
   * (`onDelete: Cascade` у wallets/ledger/sessions) уехали бы кошелёк и вся
   * история. Условия в where — единственный предохранитель на уровне запроса.
   */
  async deleteServiceUser(userId: string): Promise<boolean> {
    const deleted = await prisma.user.deleteMany({
      where: { id: userId, email: null },
    })
    return deleted.count > 0
  }
}
