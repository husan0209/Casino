import { Controller, Get, Req, UseGuards } from '@nestjs/common'
import { type Request } from 'express'

import { OptionalAuthGuard } from '../../../../common/guards/optional-auth.guard'
import { GeoFacade } from '../../facade/geo.facade'

@Controller('geo')
export class GeoController {
  constructor(private geo: GeoFacade) {}

  @Get('config')
  @UseGuards(OptionalAuthGuard)
  config(@Req() req: Request & { user?: { id: string } }) {
    const countryHeader =
      (req.headers['x-geo-country'] as string) ||
      (req.headers['cf-ipcountry'] as string) ||
      (req.query.country as string) ||
      null

    return this.geo.resolveConfig({
      hostname: req.headers.host,
      countryCode: countryHeader,
      userId: req.user?.id ?? null,
    })
  }
}
