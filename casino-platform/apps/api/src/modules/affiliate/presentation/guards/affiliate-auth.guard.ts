/**
 * Guard кабинета партнёра (ТЗ ч.8 §16).
 *
 * Пропускает ТОЛЬКО партнёрский токен (aud='affiliate'). Player- и admin-токены
 * отклоняются: контуры должны быть разделены (см. AffiliateJwtService).
 *
 * В req.user кладётся affiliateId — и ВСЕ хендлеры берут его отсюда, а не из
 * query/body. Это и есть owner-check: партнёр физически не может запросить
 * чужую статистику, передав affiliate_id (АК-критерий A20).
 */
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { type Request } from 'express'

import { type AffiliateActor } from '@/common/types/req-user'

import { AffiliateJwtService } from '../../infrastructure/affiliate-jwt.service'

@Injectable()
export class AffiliateAuthGuard implements CanActivate {
  constructor(@Inject(AffiliateJwtService) private readonly jwt: AffiliateJwtService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const request = ctx.switchToHttp().getRequest<Request>()
    const header = request.headers.authorization ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null
    if (token === null) {
      throw new UnauthorizedException('UNAUTHORIZED')
    }
    try {
      const payload = this.jwt.verifyAccess(token)
      const actor: AffiliateActor = { affiliateId: payload.sub, email: payload.email }
      request.user = actor
      return true
    } catch {
      throw new UnauthorizedException('UNAUTHORIZED')
    }
  }
}
