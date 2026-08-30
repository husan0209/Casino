import { Inject, Injectable } from '@nestjs/common'

import {
  IUserProfileRepository,
  USER_PROFILE_REPOSITORY,
} from '../../domain/repositories/user-profile.repository'

@Injectable()
export class GetGeoContextUseCase {
  constructor(@Inject(USER_PROFILE_REPOSITORY) private profiles: IUserProfileRepository) {}

  execute(userId: string) {
    return this.profiles.getGeoContext(userId)
  }
}
