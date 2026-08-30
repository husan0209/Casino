import { type IncomingMessage } from 'http'

import { type Options } from 'pino-http'

import { resolveRequestId } from '../middleware/request-id.middleware'

// GAP-23: единый источник конфигурации pino-логгера. Экспортируется для
// юнит-теста redaction (logger-redact.spec.ts) — пути должны оставаться
// синхронными с тем, что реально попадает в лог-объекты.

export const REDACT_CENSOR = '[REDACTED]'

/**
 * Пути, вырезаемые из логов (fast-redact синтаксис):
 * - плоские ключи — для структурных объектов из use-cases/фильтров;
 * - `*.key` / `*.*.key` — защита вложенных payload'ов;
 * - `req.headers.*`, `res.headers["set-cookie"]` — http-слой pino-http
 *   (authorization несёт access-token, cookie — refresh_token);
 * - `req.body.*` — тела запросов (кастомный req-сериализатор их добавляет).
 */
export const LOG_REDACT_PATHS = [
  // плоские ключи
  'password',
  'passwordHash',
  'new_password',
  'current_password',
  'old_password',
  'token',
  'refreshToken',
  'refresh_token',
  'accessToken',
  'idToken',
  'secret',
  'clientSecret',
  'authorization',
  'cookie',
  'apiKey',
  'api_key',
  // один уровень вложенности
  '*.password',
  '*.passwordHash',
  '*.new_password',
  '*.current_password',
  '*.old_password',
  '*.token',
  '*.refreshToken',
  '*.refresh_token',
  '*.accessToken',
  '*.idToken',
  '*.secret',
  '*.clientSecret',
  '*.authorization',
  '*.cookie',
  '*.apiKey',
  '*.api_key',
  // два уровня вложенности
  '*.*.password',
  '*.*.passwordHash',
  '*.*.new_password',
  '*.*.token',
  '*.*.refreshToken',
  '*.*.accessToken',
  '*.*.secret',
  '*.*.authorization',
  '*.*.cookie',
  '*.*.apiKey',
  // http-слой
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  'req.body.password',
  'req.body.passwordHash',
  'req.body.new_password',
  'req.body.current_password',
  'req.body.old_password',
  'req.body.token',
  'req.body.refresh_token',
  'req.body.secret',
] as const

type LogReq = IncomingMessage & {
  id?: string
  body?: unknown
  socket?: { remoteAddress?: string }
}

export function buildPinoHttpOptions(): Options {
  const level = process.env['LOG_LEVEL'] ?? 'info'
  const format =
    process.env['LOG_FORMAT'] ?? (process.env['NODE_ENV'] === 'production' ? 'json' : 'pretty')
  const options: Options = {
    level,
    redact: { paths: [...LOG_REDACT_PATHS], censor: REDACT_CENSOR },
    // Корреляция с X-Request-Id: RequestIdMiddleware и pino используют одну
    // логику resolveRequestId; кто сработал первым — тот id и живёт в req.id.
    genReqId: (req) =>
      (req as LogReq).id ?? resolveRequestId(req.headers['x-request-id']),
    autoLogging: { ignore: (req) => req.url?.includes('/health') ?? false },
    serializers: {
      // Кастомный req-сериализатор: добавляет body (тела нужны для отладки,
      // секреты вырезаются redact-путями req.body.*) и заголовки.
      req: (req) => {
        const r = req as LogReq
        return {
          id: r.id,
          method: r.method,
          url: r.url,
          remoteAddress: r.socket?.remoteAddress,
          headers: r.headers,
          body: r.body,
        }
      },
    },
  }
  // transport добавляем только когда нужен — с exactOptionalPropertyTypes
  // нельзя присвоить transport: undefined явно.
  if (format === 'pretty') {
    options.transport = {
      target: 'pino-pretty',
      options: {
        translateTime: 'SYS:standard',
        singleLine: true,
        colorize: process.env['NODE_ENV'] !== 'production',
      },
    }
  }
  return options
}
