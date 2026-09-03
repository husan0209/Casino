import type { ExecutionContext } from '@nestjs/common'
import type { Request } from 'express'

/**
 * Типизированный доступ к underlying express-Request из ExecutionContext.
 *
 * `ctx.switchToHttp().getRequest()` в Nest возвращает `any` — это источник
 * no-unsafe-* каскада в guards/decorators/interceptors (GAP-39 stage 10).
 * Здесь каст изолирован в одном месте с честным типом.
 */
export function getHttpRequest<T = Request>(ctx: ExecutionContext): T {
  return ctx.switchToHttp().getRequest<T>()
}
