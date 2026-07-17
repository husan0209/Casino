import { CanActivate, ExecutionContext, Injectable, ForbiddenException, SetMetadata } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
export const Roles = (...roles: string[]) => SetMetadata('roles', roles)
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.get<string[]>('roles', ctx.getHandler())
    if (!roles) return true
    const req = ctx.switchToHttp().getRequest()
    const user = req.user
    if (!user || !roles.includes(user.role)) throw new ForbiddenException('INSUFFICIENT_PERMISSIONS')
    return true
  }
}
