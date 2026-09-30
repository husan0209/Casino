import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { getHttpRequest } from '@/common/types/express-context'

import { InsufficientPermissionsError } from '../../domain/errors'

export const Roles = (...roles: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata('roles', roles)
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private reflector: Reflector) {}
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
    if (user === undefined) {
      throw new InsufficientPermissionsError()
    }
    // AffiliateActor поля role не имеет — партнёр не админ ни при каких условиях.
    // Отсутствие роли само по себе отсекает партнёрский токен от admin-эндпоинтов.
    const role = 'role' in user ? user.role : null
    if (role === null || !roles.includes(role)) {
      throw new InsufficientPermissionsError()
    }
    return true
  }
}
