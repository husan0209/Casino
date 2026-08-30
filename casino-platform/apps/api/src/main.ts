import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { type NestExpressApplication } from '@nestjs/platform-express'
import cookieParser from 'cookie-parser'
import { json, urlencoded, type Request, type Response } from 'express'
import helmet from 'helmet'
import { Logger } from 'nestjs-pino'

import { AppModule } from './app.module'

/**
 * Capture the raw request body bytes for webhook signature verification.
 *
 * Payment provider webhooks (Rukassa, NOWPayments) sign the exact bytes of
 * the HTTP body. If we re-serialise the parsed JSON to verify the signature,
 * formatting differences (key order, whitespace, numeric precision) can cause
 * a valid signature to be rejected — or worse, let an attacker forge one.
 *
 * This callback is invoked by express.json() AFTER it parses the body, so
 * `req.body` is still available; we just stash the original Buffer as
 * `req.rawBody` (string) for HMAC verification.
 */
interface RawBodyRequest extends Request {
  rawBody?: string
}

function captureRawBody(req: Request, _res: Response, buf: Buffer, _encoding: string): void {
  (req as RawBodyRequest).rawBody = buf.toString('utf8')
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false, // we wire our own to attach the verify callback
  })

  // Security headers (GAP-20). API отдаёт только JSON, поэтому дефолтный CSP
  // безопасен; frame-ancestors 'none' блокирует clickjacking на swagger/админке.
  app.use(helmet())

  // JSON parser with rawBody capture (must be before routes that need rawBody)
  app.use(json({ limit: '1mb', verify: captureRawBody }))
  app.use(urlencoded({ extended: true, limit: '1mb', verify: captureRawBody }))

  // GAP-23: все Nest-логи (включая Logger из use-cases/services) идут через pino
  // с redact — пароли/токены/cookie в логи не попадают.
  app.useLogger(app.get(Logger))
  app.setGlobalPrefix('api/v1')
  app.enableCors({
    origin: (process.env['CORS_ORIGINS'] || 'http://localhost:3000,http://localhost:3002')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    credentials: true,
  })
  app.use(cookieParser())

  const port = process.env['APP_PORT'] || 3001
  await app.listen(port)
  app.get(Logger).log(`API listening on http://localhost:${port}/api/v1`)
}
void bootstrap()
