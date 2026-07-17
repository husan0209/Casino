import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pino = require('pino')

async function bootstrap() {
  const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.LOG_FORMAT === 'pretty' ? { target: 'pino-pretty' } : undefined,
    redact: {
      paths: [
        'password', '*.password', 'req.headers.authorization', 'req.headers.cookie',
        '*.secret', '*.apiKey', '*.token'
      ],
      censor: '[REDACTED]',
    },
  })

  const app = await NestFactory.create(AppModule, { bufferLogs: true })
  app.setGlobalPrefix('api/v1')
  app.enableCors({
    origin: (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:3002').split(','),
    credentials: true,
  })

  const port = process.env.APP_PORT || 3001
  await app.listen(port)
  logger.info(`API listening on http://localhost:${port}/api/v1`)
}
bootstrap()
