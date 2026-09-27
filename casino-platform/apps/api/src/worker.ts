import 'reflect-metadata'
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { Logger, LoggerModule } from 'nestjs-pino'

import { validateEnv } from '@casino/shared-config'

import { buildPinoHttpOptions } from './common/logger/logger.options'
import { initSentry } from './common/sentry/sentry.options'
import { QueuesModule } from './queues/queues.module'

/**
 * Отдельный процесс-консьюмер очереди `email` (GAP-02 post-MVP, запуск:
 * `node dist/worker.js`, сервис `worker` в docker-compose.prod.yml).
 *
 * createApplicationContext — тот же DI-контейнер, что у API, но без HTTP-сервера
 * и контроллеров: email-обработке нужны только ConfigModule (env-валидация),
 * pino (структурные логи с redact, GAP-23) и QueuesModule (EmailWorker + MAILER_PORT
 * → SmtpMailer). Prisma воркер использует напрямую (@casino/database), контроллеры
 * ему не нужны. Maintenance-очередь (GAP-33) остаётся в процессе API — вне скоупа.
 *
 * В процессе API консьюмер по-прежнему поднимается по умолчанию (dev-удобство);
 * флаг EMAIL_WORKER_IN_PROCESS=false отключает его — прод-компоновка делает это
 * за сервис `api` и включает за сервисом `worker`.
 */
@Module({
  imports: [
    LoggerModule.forRoot({ pinoHttp: buildPinoHttpOptions() }),
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    QueuesModule,
  ],
})
export class WorkerModule {}

async function bootstrap(): Promise<void> {
  // Sentry до бутстрапа — как в main.ts: ловит и ошибки инициализации DI (DSN опционален).
  initSentry(process.env['SENTRY_DSN'])

  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  })
  app.useLogger(app.get(Logger))
  // SIGTERM (деплой/рестарт) → onModuleDestroy у EmailWorker: worker.close()
  // дожидается активных job'ов — stop_grace_period 45s в compose покрывает это окно.
  app.enableShutdownHooks()
  app.get(Logger).log('Email worker process started (queue "email")')
}
void bootstrap()
