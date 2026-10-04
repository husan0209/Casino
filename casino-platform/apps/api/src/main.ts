import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { type NestExpressApplication } from '@nestjs/platform-express'
import cookieParser from 'cookie-parser'
import { json, urlencoded, type Request } from 'express'
import helmet from 'helmet'
import { Logger } from 'nestjs-pino'

import { AppModule } from './app.module'
import { initSentry } from './common/sentry/sentry.options'

import type { IncomingMessage, ServerResponse } from 'http'

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

function captureRawBody(
  req: IncomingMessage,
  _res: ServerResponse<IncomingMessage>,
  buf: Buffer,
  _encoding: string,
): void {
  // verify-колбэк body-parser получает IncomingMessage; Request (с rawBody) — подтип.
  // Присваивание идёт через локальную переменную, а не `(req as …).rawBody = …`:
  // выражение, начинающееся со скобки, prettier защищает точкой с запятой, а eslint
  // считает её `no-extra-semi` — на этой строке два инструмента спорили, и любой PR,
  // тронувший main.ts, краснел в CI (проверяется `prettier --check` на файле).
  const withRawBody = req as RawBodyRequest
  withRawBody.rawBody = buf.toString('utf8')
}

async function bootstrap(): Promise<void> {
  // GAP-50: Sentry-агрегатор ошибок (вне ТЗ, согласовано владельцем 2026-09-04).
  // DSN опционален: без него init не вызывается — dev/CI не шумят. Инициализация
  // ДО NestFactory, чтобы ловить и ошибки бутстрапа (DI-провалы и пр.).
  initSentry(process.env['SENTRY_DSN'])

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false, // we wire our own to attach the verify callback
  })

  // GAP-19 (brute-force лимиты) зависят от того, чей адрес считает Express. Без
  // `trust proxy` `req.ip` = адрес nginx (docker-мост), а не клиента, и это
  // ломает три вещи сразу:
  //   1) ThrottlerGuard: все игроки платформы попадают в ОДНУ корзину — глобальный
  //      120/мин и auth-лимит 10/мин становятся лимитом на всех, легитимные
  //      пользователи получают 429, а защита от брутфорса теряет смысл (атакующий
  //      делит корзину с жертвой, а не упирается в свой собственный лимит);
  //   2) `sessions.ipAddress` (login/register/refresh) заполняется адресом прокси —
  //      список сессий игрока в `/users/sessions` и отзыв по id перестают различать
  //      устройства, разбор инцидентов становится невозможным;
  //   3) партнёрская атрибуция: `track-click` хешует IP, а `attribute-player`
  //      сравнивает эти хеши (`lastClick.ipHash === hash(ip)`) — при постоянном
  //      значении атрибуция матчится между чужими устройствами.
  //
  // hop count = 1: единственный прокси — наш nginx. `templates/casino.conf.template:55`
  // отдаёт `X-Forwarded-For: $proxy_add_x_forwarded_for`, поэтому правый элемент
  // цепочки — адрес реального соединения, подменить который клиент не может.
  // Значение `true` (доверять всем хопам) открыло бы обход лимита собственным
  // `X-Forwarded-For`. Если перед nginx появится CDN или ещё один балансировщик —
  // число хопов нужно увеличить на единицу.
  app.set('trust proxy', 1)

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

  // pre-launch hardening A4 (2026-09-04): без enableShutdownHooks() SIGTERM
  // (деплой/рестарт/rollback) обрывал in-flight запросы и Prisma-транзакции
  // посреди money-операций, а onModuleDestroy-хуки BullMQ-воркеров (закрытие
  // очередей, дожидание активных job'ов) не вызывались вовсе. С хуками Nest:
  // 1) перестаёт принимать соединения, 2) дожидается активных запросов,
  // 3) вызывает onModuleDestroy у воркеров (email/maintenance: worker.close()
  // с ожиданием текущих job'ов). Пул Prisma закрывается сам при exit.
  // K8s/compose stop_grace_period должен быть ≥ этого окна (30s default).
  app.enableShutdownHooks()

  const port = process.env['APP_PORT'] || 3001
  await app.listen(port)
  app.get(Logger).log(`API listening on http://localhost:${port}/api/v1`)
}
void bootstrap()
