import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtTokenService } from '../../infrastructure/services/jwt.service'
import { Request } from 'express'
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private jwt: JwtTokenService) {}
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request & { user?: any }>()
    const auth = req.headers.authorization || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
    if (!token) throw new UnauthorizedException('UNAUTHORIZED')
    try {
      const payload = this.jwt.verifyAccess(token)
      req.user = { id: payload.sub, role: payload.role, sessionId: payload.session_id }
      return true
    } catch { throw new UnauthorizedException('UNAUTHORIZED') }
  }
}
