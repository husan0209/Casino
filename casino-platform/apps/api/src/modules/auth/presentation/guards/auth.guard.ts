import {
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common'
import { type Request } from 'express'

import { JwtTokenService } from '../../infrastructure/services/jwt.service'

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(JwtTokenService) private jwt: JwtTokenService) {}
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>()
    const auth = req.headers.authorization || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
    if (!token) {
      throw new UnauthorizedException('UNAUTHORIZED')
    }
    try {
      const payload = this.jwt.verifyAccess(token)
      req.user = { id: payload.sub, role: payload.role, sessionId: payload.session_id }
      return true
    } catch {
      throw new UnauthorizedException('UNAUTHORIZED')
    }
  }
}
