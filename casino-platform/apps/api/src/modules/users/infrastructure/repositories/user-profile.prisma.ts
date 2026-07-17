import { Injectable } from '@nestjs/common'
import { prisma } from '@casino/database'
import { IUserProfileRepository } from '../../domain/repositories/user-profile.repository'
@Injectable()
export class PrismaUserProfileRepository implements IUserProfileRepository {
  async getMe(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true, settings: true, kycProfile: true }
    })
    if (!user) return null
    return {
      user: { id: user.id, email: user.email, status: user.status, role: user.role, referralCode: user.referralCode, createdAt: user.createdAt },
      profile: user.profile,
      settings: user.settings,
      kycStatus: user.kycProfile?.status ?? 'not_started',
    }
  }
  async updateProfile(userId: string, data: any) {
    await prisma.userProfile.upsert({
      where: { userId },
      update: { firstName: data.firstName, lastName: data.lastName, dateOfBirth: data.dateOfBirth ?? undefined, country: data.country, city: data.city },
      create: { userId, firstName: data.firstName ?? null, lastName: data.lastName ?? null, dateOfBirth: data.dateOfBirth ?? null, country: data.country ?? null, city: data.city ?? null }
    })
  }
  async updateSettings(userId: string, data: any) {
    await prisma.userSettings.upsert({
      where: { userId },
      update: { notificationsEmail: data.notificationsEmail, notificationsPush: data.notificationsPush, language: data.language, timezone: data.timezone },
      create: { userId, notificationsEmail: data.notificationsEmail ?? true, notificationsPush: data.notificationsPush ?? true, language: data.language ?? 'ru', timezone: data.timezone ?? 'Europe/Moscow' }
    })
  }
  async setAvatar(userId: string, avatarUrl: string) {
    await prisma.userProfile.upsert({
      where: { userId },
      update: { avatarUrl },
      create: { userId, avatarUrl }
    })
  }
}
