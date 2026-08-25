import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { NestExpressApplication } from '@nestjs/platform-express'
import { json, urlencoded } from 'express'
import cookieParser from 'cookie-parser'
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
function captureRawBody(req: { rawBody?: string }, _res: unknown, buf: Buffer): void {
  req.rawBody = buf.toString('utf8')
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false, // we wire our own to attach the verify callback
  })

  // JSON parser with rawBody capture (must be before routes that need rawBody)
  app.use(json({ limit: '1mb', verify: captureRawBody }))
  app.use(urlencoded({ extended: true, limit: '1mb', verify: captureRawBody }))

  app.useLogger(new Logger())
  app.setGlobalPrefix('api/v1')
  app.enableCors({
    origin: (process.env['CORS_ORIGINS'] || 'http://localhost:3000,http://localhost:3002').split(','),
    credentials: true,
  })
  app.use(cookieParser())

  const port = process.env['APP_PORT'] || 3001
  await app.listen(port)
  new Logger('Bootstrap').log(`API listening on http://localhost:${port}/api/v1`)
}
bootstrap()
