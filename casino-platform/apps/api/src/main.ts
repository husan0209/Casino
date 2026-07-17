import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
// @ts-ignore
import cookieParser from 'cookie-parser'
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true })
  app.setGlobalPrefix('api/v1')
  app.enableCors({ origin: (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:3002').split(','), credentials: true })
  app.use(cookieParser())
  const port = process.env.APP_PORT || 3001
  await app.listen(port)
  console.log(`API listening on http://localhost:${port}/api/v1`)
}
bootstrap()
