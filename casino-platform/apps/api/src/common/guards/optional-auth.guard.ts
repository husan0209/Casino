import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common'
import { type Request } from 'express'

import { JwtTokenService } from '../../modules/auth/infrastructure/services/jwt.service'

/** Sets req.user when Bearer token is valid; does not fail for guests. */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(private jwt: JwtTokenService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>()
    const auth = req.headers.authorization || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
    if (!token) {
      return true
    }
    try {
      const payload = this.jwt.verifyAccess(token)
      req.user = { id: payload.sub, role: payload.role, sessionId: payload.session_id }
    } catch {
      /* guest */
    }
    return true
  }
}
