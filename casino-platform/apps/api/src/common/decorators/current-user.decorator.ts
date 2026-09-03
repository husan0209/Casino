import { createParamDecorator, type ExecutionContext } from '@nestjs/common'

import { getHttpRequest } from '@/common/types/express-context'
import { type AdminActor, type UserActor } from '@/common/types/req-user'

/**
 * req.user, который положил guard: UserAuthGuard/OptionalAuthGuard → UserActor,
 * AdminAuthGuard → AdminActor (типы в common/types/req-user.ts).
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): UserActor | AdminActor | undefined =>
    getHttpRequest(ctx).user,
)
