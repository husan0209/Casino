import { Injectable } from '@nestjs/common'

import { type GeoConfigResult, resolveGeoConfig } from '@modules/geo/domain/geo-config.policy'
import { type UsersFacade } from '@modules/users/facade/users.facade'

export interface ResolveGeoInput {
  hostname?: string | undefined
  countryCode?: string | null
  userId?: string | null
}

@Injectable()
export class GetGeoConfigUseCase {
  constructor(private users: UsersFacade) {}

  async execute(input: ResolveGeoInput): Promise<GeoConfigResult> {
    const userContext = input.userId ? await this.users.getGeoContext(input.userId) : null
    return resolveGeoConfig({
      hostname: input.hostname,
      countryCode: input.countryCode,
      userContext,
    })
  }
}
