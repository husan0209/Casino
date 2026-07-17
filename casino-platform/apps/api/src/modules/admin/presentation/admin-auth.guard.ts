import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { AdminAuthService } from '../infrastructure/admin-jwt.service'
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private auth: AdminAuthService) {}
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest()
    const h = req.headers.authorization || ''
    const token = h.startsWith('Bearer ') ? h.slice(7) : null
    if (!token) throw new UnauthorizedException()
    try {
      const p: any = this.auth.verify(token)
      if (p.aud !== 'admin') throw new Error()
      req.user = { id: p.sub, role: p.role, isAdmin: true }
      return true
    } catch { throw new UnauthorizedException() }
  }
}
