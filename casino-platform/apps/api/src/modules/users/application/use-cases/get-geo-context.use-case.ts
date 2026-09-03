import { Inject, Injectable } from '@nestjs/common'

import { type UserGeoContext } from '@modules/geo/domain/geo-config.policy'

import {
  type IUserProfileRepository,
  USER_PROFILE_REPOSITORY,
} from '../../domain/repositories/user-profile.repository'

@Injectable()
export class GetGeoContextUseCase {
  constructor(@Inject(USER_PROFILE_REPOSITORY) private profiles: IUserProfileRepository) {}

  execute(userId: string): Promise<UserGeoContext | null> {
    return this.profiles.getGeoContext(userId)
  }
}
