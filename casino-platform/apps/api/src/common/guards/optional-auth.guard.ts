import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { JwtTokenService } from '../../modules/auth/infrastructure/services/jwt.service'
import { Request } from 'express'

/** Sets req.user when Bearer token is valid; does not fail for guests. */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(private jwt: JwtTokenService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request & { user?: any }>()
    const auth = req.headers.authorization || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
    if (!token) return true
    try {
      const payload = this.jwt.verifyAccess(token)
      req.user = { id: payload.sub, role: payload.role, sessionId: payload.session_id }
    } catch {
      /* guest */
    }
    return true
  }
}
