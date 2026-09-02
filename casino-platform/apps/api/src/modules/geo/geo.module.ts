import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { UsersModule } from '../users/users.module'
import { ExchangeRatesService, EXCHANGE_RATES_READER } from './application/exchange-rates.service'
import { GetGeoConfigUseCase } from './application/use-cases/get-geo-config.use-case'
import { GeoFacade } from './facade/geo.facade'
import { PrismaExchangeRatesReader } from './infrastructure/exchange-rates.prisma.reader'
import { GeoController } from './presentation/controllers/geo.controller'

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [GeoController],
  providers: [
    GetGeoConfigUseCase,
    GeoFacade,
    ExchangeRatesService,
    PrismaExchangeRatesReader,
    { provide: EXCHANGE_RATES_READER, useExisting: PrismaExchangeRatesReader },
  ],
  exports: [ExchangeRatesService, GeoFacade],
})
export class GeoModule {}
