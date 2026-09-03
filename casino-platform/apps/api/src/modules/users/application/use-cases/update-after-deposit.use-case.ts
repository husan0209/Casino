import { Inject, Injectable } from '@nestjs/common'

import {
  IUserProfileRepository,
  USER_PROFILE_REPOSITORY,
} from '../../domain/repositories/user-profile.repository'

@Injectable()
export class UpdateAfterDepositUseCase {
  constructor(@Inject(USER_PROFILE_REPOSITORY) private profiles: IUserProfileRepository) {}

  async execute(userId: string, currency: string, method: string): Promise<void> {
    await this.profiles.updateAfterDeposit(userId, currency, method)
  }
}
