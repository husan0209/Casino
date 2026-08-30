import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core'

import { validateEnv } from '@casino/shared-config'

import { GlobalExceptionFilter } from './common/filters/global-exception.filter'
import { ResponseFormatInterceptor } from './common/interceptors/response-format.interceptor'
import { RequestIdMiddleware } from './common/middleware/request-id.middleware'
import { AdminModule } from './modules/admin/admin.module'
import { AuthModule } from './modules/auth/auth.module'
import { CasinoModule } from './modules/casino/casino.module'
import { GeoModule } from './modules/geo/geo.module'
import { HealthModule } from './modules/health/health.module'
import { KycModule } from './modules/kyc/kyc.module'
import { NotificationsModule } from './modules/notifications/notifications.module'
import { PaymentsModule } from './modules/payments/payments.module'
import { ReferralsModule } from './modules/referrals/referrals.module'
import { SupportModule } from './modules/support/support.module'
import { UsersModule } from './modules/users/users.module'
import { WalletModule } from './modules/wallet/wallet.module'
import { QueuesModule } from './queues/queues.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    HealthModule,
    AuthModule,
    UsersModule,
    KycModule,
    AdminModule,
    GeoModule,
    WalletModule,
    PaymentsModule,
    CasinoModule,
    SupportModule,
    ReferralsModule,
    NotificationsModule,
    QueuesModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseFormatInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*')
  }
}
