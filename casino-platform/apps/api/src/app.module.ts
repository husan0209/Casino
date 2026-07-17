import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { validateEnv } from '@casino/shared-config'
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core'
import { GlobalExceptionFilter } from './common/filters/global-exception.filter'
import { ResponseFormatInterceptor } from './common/interceptors/response-format.interceptor'
import { RequestIdMiddleware } from './common/middleware/request-id.middleware'
import { HealthModule } from './modules/health/health.module'
import { AuthModule } from './modules/auth/auth.module'
import { UsersModule } from './modules/users/users.module'
import { KycModule } from './modules/kyc/kyc.module'
import { AdminModule } from './modules/admin/admin.module'
import { WalletModule } from './modules/wallet/wallet.module'
import { PaymentsModule } from './modules/payments/payments.module'
import { CasinoModule } from './modules/casino/casino.module'
import { SupportModule } from './modules/support/support.module'
import { ReferralsModule } from './modules/referrals/referrals.module'
import { NotificationsModule } from './modules/notifications/notifications.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    HealthModule, AuthModule, UsersModule, KycModule, AdminModule,
    WalletModule, PaymentsModule, CasinoModule, SupportModule, ReferralsModule, NotificationsModule,
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
