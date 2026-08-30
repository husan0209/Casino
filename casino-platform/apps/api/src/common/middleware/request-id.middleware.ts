import { randomUUID } from 'crypto'

import { Injectable, type NestMiddleware } from '@nestjs/common'
import { type Request, type Response, type NextFunction } from 'express'

// Whitelist for client-supplied X-Request-Id. Anything outside this pattern
// is silently replaced with a fresh UUID to prevent:
// - log injection (CRLF, control chars in the id end up in log files)
// - response header injection (Express usually sanitizes, but defense in depth)
// - stored XSS if the id is ever rendered into HTML
const REQUEST_ID_PATTERN = /^[a-zA-Z0-9-]{1,128}$/

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request & { id?: string }, res: Response, next: NextFunction) {
    const raw = req.headers['x-request-id']
    const candidate = Array.isArray(raw) ? raw[0] : raw
    const id =
      typeof candidate === 'string' && REQUEST_ID_PATTERN.test(candidate) ? candidate : randomUUID()
    req.id = id
    res.setHeader('X-Request-Id', id)
    next()
  }
}
