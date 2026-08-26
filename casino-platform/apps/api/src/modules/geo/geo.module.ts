import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { UsersModule } from '../users/users.module'
import { GetGeoConfigUseCase } from './application/use-cases/get-geo-config.use-case'
import { GeoFacade } from './facade/geo.facade'
import { GeoController } from './presentation/controllers/geo.controller'

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [GeoController],
  providers: [GetGeoConfigUseCase, GeoFacade],
  exports: [GeoFacade],
})
export class GeoModule {}
