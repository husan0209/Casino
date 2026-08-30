import { Injectable } from '@nestjs/common'

import { UsersFacade } from '../../../users/facade/users.facade'
import { resolveGeoConfig } from '../../domain/geo-config.policy'

export interface ResolveGeoInput {
  hostname?: string | undefined
  countryCode?: string | null
  userId?: string | null
}

@Injectable()
export class GetGeoConfigUseCase {
  constructor(private users: UsersFacade) {}

  async execute(input: ResolveGeoInput) {
    const userContext = input.userId ? await this.users.getGeoContext(input.userId) : null
    return resolveGeoConfig({
      hostname: input.hostname,
      countryCode: input.countryCode,
      userContext,
    })
  }
}
