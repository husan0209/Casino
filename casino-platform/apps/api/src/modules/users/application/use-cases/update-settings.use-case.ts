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
      notificationsEmail: input.notifications_email,
      notificationsPush: input.notifications_push,
      language: input.language,
      timezone: input.timezone,
    })
    return { ok: true }
  }
}
