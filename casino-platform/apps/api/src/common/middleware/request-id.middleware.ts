import { randomUUID } from 'crypto'

import { Injectable, type NestMiddleware } from '@nestjs/common'
import { type Request, type Response, type NextFunction } from 'express'

// Whitelist for client-supplied X-Request-Id. Anything outside this pattern
// is silently replaced with a fresh UUID to prevent:
// - log injection (CRLF, control chars in the id end up in log files)
// - response header injection (Express usually sanitizes, but defense in depth)
// - stored XSS if the id is ever rendered into HTML
const REQUEST_ID_PATTERN = /^[a-zA-Z0-9-]{1,128}$/

/**
 * GAP-23: единая логика резолва request-id для RequestIdMiddleware и pino
 * (genReqId в logger.options.ts) — чтобы оба всегда сошлись на одном id:
 * уважает клиентский X-Request-Id из белого списка, иначе генерирует UUID.
 */
export function resolveRequestId(candidate: unknown): string {
  const value = Array.isArray(candidate) ? (candidate as unknown[])[0] : candidate
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value) ? value : randomUUID()
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    // req.id может быть уже установлен pino-логгером (genReqId) — не перезатираем,
    // иначе id в логах и в ответе разъедутся.
    const id = req.id ?? resolveRequestId(req.headers['x-request-id'])
    req.id = id
    res.setHeader('X-Request-Id', id)
    next()
  }
}
