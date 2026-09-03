import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { getHttpRequest } from '@/common/types/express-context'

export const Roles = (...roles: string[]) => SetMetadata('roles', roles)
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    // getAllAndOverride по [handler, class]: class-level @Roles применялся ранее
    // только через get(handler) и ИГНОРИРОВАЛСЯ — любой авторизованный user
    // проходил на admin-эндпоинты (найдено при GAP-32, фикс + test/roles-guard.spec.ts)
    const roles = this.reflector.getAllAndOverride<string[] | undefined>('roles', [
      ctx.getHandler(),
      ctx.getClass(),
    ])
    if (!roles) {
      return true
    }
    const user = getHttpRequest(ctx).user
    if (!user || !roles.includes(user.role)) {
      throw new ForbiddenException('INSUFFICIENT_PERMISSIONS')
    }
    return true
  }
}
