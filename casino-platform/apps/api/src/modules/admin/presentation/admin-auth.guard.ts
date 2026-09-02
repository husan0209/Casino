import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'

import { AdminAuthService } from '../infrastructure/admin-jwt.service'

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private auth: AdminAuthService) {}
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest()
    const h = req.headers.authorization || ''
    const token = h.startsWith('Bearer ') ? h.slice(7) : null
    if (!token) {
      throw new UnauthorizedException()
    }
    try {
      const p = this.auth.verify(token) as Record<string, unknown>
      const aud = typeof p['aud'] === 'string' ? p['aud'] : ''
      if (aud !== 'admin') {
        throw new Error()
      }
      const sub = typeof p['sub'] === 'string' ? p['sub'] : ''
      const role = typeof p['role'] === 'string' ? p['role'] : ''
      req.user = { id: sub, role, isAdmin: true }
      if (p.aud !== 'admin') {
        throw new Error()
      }
      req.user = { id: p.sub, role: p.role, isAdmin: true }
      return true
    } catch {
      throw new UnauthorizedException()
    }
  }
}
