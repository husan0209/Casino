import { Inject, Injectable } from '@nestjs/common'

import { type IUserProfileRepository, USER_PROFILE_REPOSITORY, type UserProfileFull } from '../../domain/repositories/user-profile.repository'

@Injectable()
export class GetMeUseCase {
  constructor(@Inject(USER_PROFILE_REPOSITORY) private repo: IUserProfileRepository) {}
  async execute(userId: string): Promise<UserProfileFull> {
    const data = await this.repo.getMe(userId)
    if (!data) {
      throw new Error('NOT_FOUND')
    }
    return data
  }
}
