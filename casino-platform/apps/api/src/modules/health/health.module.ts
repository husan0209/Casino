import { Module } from '@nestjs/common'

import { GetReadinessUseCase } from './application/use-cases/get-readiness.use-case'
import { HEALTH_PROBES } from './domain/health.ports'
import { PrismaHealthProbe } from './infrastructure/probes/prisma-health.probe'
import { RedisHealthProbe } from './infrastructure/probes/redis-health.probe'
import { HealthController } from './presentation/health.controller'

/**
 * Health-модуль — 4 слоя (решение В2): domain — типы отчёта и порт пробы
 * (health.ports.ts); application — GetReadinessUseCase (агрегация проб);
 * infrastructure — пробы БД/Redis (implement IHealthProbe); presentation —
 * тонкий контроллер с прежними маршрутами /health, /health/live, /health/ready
 * и прежним форматом ответа (GAP-35).
 */
@Module({
  controllers: [HealthController],
  providers: [
    PrismaHealthProbe,
    RedisHealthProbe,
    {
      provide: HEALTH_PROBES,
      useFactory: (db: PrismaHealthProbe, redis: RedisHealthProbe) => [db, redis],
      inject: [PrismaHealthProbe, RedisHealthProbe],
    },
    GetReadinessUseCase,
  ],
})
export class HealthModule {}
