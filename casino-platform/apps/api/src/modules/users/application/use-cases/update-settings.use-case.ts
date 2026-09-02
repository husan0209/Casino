import { Inject, Injectable } from '@nestjs/common'

import {
  USER_PROFILE_REPOSITORY,
  IUserProfileRepository,
} from '../../domain/repositories/user-profile.repository'

interface UpdateSettingsInput {
  notifications_email?: boolean
  notifications_push?: boolean
  language?: string
  timezone?: string
}

@Injectable()
export class UpdateSettingsUseCase {
  constructor(@Inject(USER_PROFILE_REPOSITORY) private repo: IUserProfileRepository) {}
  async execute(userId: string, input: UpdateSettingsInput) {
    await this.repo.updateSettings(userId, {
      ...(input.notifications_email !== undefined && { notificationsEmail: input.notifications_email }),
      ...(input.notifications_push !== undefined && { notificationsPush: input.notifications_push }),
      ...(input.language !== undefined && { language: input.language }),
      ...(input.timezone !== undefined && { timezone: input.timezone }),
    })
    return { ok: true }
  }
}
