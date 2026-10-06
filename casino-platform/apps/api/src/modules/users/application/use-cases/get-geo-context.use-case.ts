import { Inject, Injectable } from '@nestjs/common'

import {
  type IUserProfileRepository,
  USER_PROFILE_REPOSITORY,
  type UserGeoContext,
} from '../../domain/repositories/user-profile.repository'

@Injectable()
export class GetGeoContextUseCase {
  constructor(@Inject(USER_PROFILE_REPOSITORY) private profiles: IUserProfileRepository) {}

  execute(userId: string): Promise<UserGeoContext | null> {
    return this.profiles.getGeoContext(userId)
  }
}
