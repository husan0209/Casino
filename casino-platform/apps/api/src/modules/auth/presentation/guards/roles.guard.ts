import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'

export const Roles = (...roles: string[]) => SetMetadata('roles', roles)
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    // getAllAndOverride по [handler, class]: class-level @Roles применялся ранее
    // только через get(handler) и ИГНОРИРОВАЛСЯ — любой авторизованный user
    // проходил на admin-эндпоинты (найдено при GAP-32, фикс + test/roles-guard.spec.ts)
    const roles = this.reflector.getAllAndOverride<string[]>('roles', [
      ctx.getHandler(),
      ctx.getClass(),
    ])
    if (!roles) {
      return true
    }
    const req = ctx.switchToHttp().getRequest()
    const user = req.user
    if (!user || !roles.includes(user.role)) {
      throw new ForbiddenException('INSUFFICIENT_PERMISSIONS')
    }
    return true
  }
}
