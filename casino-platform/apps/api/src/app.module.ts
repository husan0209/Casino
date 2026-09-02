import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { LoggerModule } from 'nestjs-pino'

import { validateEnv } from '@casino/shared-config'

import { GlobalExceptionFilter } from './common/filters/global-exception.filter'
import { ResponseFormatInterceptor } from './common/interceptors/response-format.interceptor'
import { buildPinoHttpOptions } from './common/logger/logger.options'
import { RequestIdMiddleware } from './common/middleware/request-id.middleware'
import { AdminModule } from './modules/admin/admin.module'
import { AuthModule } from './modules/auth/auth.module'
import { CasinoModule } from './modules/casino/casino.module'
import { GeoModule } from './modules/geo/geo.module'
import { HealthModule } from './modules/health/health.module'
import { KycModule } from './modules/kyc/kyc.module'
import { MaintenanceModule } from './modules/maintenance/maintenance.module'
import { NotificationsModule } from './modules/notifications/notifications.module'
import { PaymentsModule } from './modules/payments/payments.module'
import { ReferralsModule } from './modules/referrals/referrals.module'
import { SupportModule } from './modules/support/support.module'
import { UsersModule } from './modules/users/users.module'
import { WalletModule } from './modules/wallet/wallet.module'
import { QueuesModule } from './queues/queues.module'

@Module({
  imports: [
    // GAP-23: структурные JSON-логи (pino) c redact паролей/токенов/cookie.
    // Первым в списке — чтобы pino-middleware зарегистрировался раньше RequestIdMiddleware;
    // корреляция id всё равно двусторонняя (req.id ?? resolveRequestId).
    LoggerModule.forRoot({ pinoHttp: buildPinoHttpOptions() }),
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // GAP-19: глобальный rate limit по IP. Дефолт — 120 запросов/минуту;
    // auth-эндпоинты переопределяют лимит строже (@Throttle), webhook'и
    // провайдеров исключены (@SkipThrottle — у них HMAC-подпись).
    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env['THROTTLE_TTL_MS'] ?? 60_000),
        limit: Number(process.env['THROTTLE_GLOBAL_LIMIT'] ?? 120),
      },
    ]),
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
    MaintenanceModule,
    QueuesModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseFormatInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*')
  }
}
