import { Inject, Injectable } from '@nestjs/common'
import { USER_PROFILE_REPOSITORY, IUserProfileRepository } from '../../domain/repositories/user-profile.repository'
@Injectable()
export class UpdateProfileUseCase {
  constructor(@Inject(USER_PROFILE_REPOSITORY) private repo: IUserProfileRepository) {}
  async execute(userId: string, input: { first_name?: string; last_name?: string; date_of_birth?: string; country?: string; city?: string }) {
    await this.repo.updateProfile(userId, {
      firstName: input.first_name,
      lastName: input.last_name,
      dateOfBirth: input.date_of_birth ? new Date(input.date_of_birth) : undefined,
      country: input.country,
      city: input.city,
    })
    return { ok: true }
  }
}
