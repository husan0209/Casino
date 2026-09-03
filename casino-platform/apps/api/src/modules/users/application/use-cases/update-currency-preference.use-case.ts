import { Inject, Injectable } from '@nestjs/common'

import {
  IUserProfileRepository,
  USER_PROFILE_REPOSITORY,
} from '../../domain/repositories/user-profile.repository'

@Injectable()
export class UpdateCurrencyPreferenceUseCase {
  constructor(@Inject(USER_PROFILE_REPOSITORY) private profiles: IUserProfileRepository) {}

  async execute(userId: string, currency: string): Promise<{ currency_preference: string; }> {
    await this.profiles.updateCurrencyPreference(userId, currency)
    return { currency_preference: currency }
  }
}
