/**
 * Формы req.user, которые кладут guard'ы проекта.
 *
 * - UserAuthGuard / OptionalAuthGuard (auth module) → UserActor
 * - AdminAuthGuard (admin module) → AdminActor
 *
 * Типы вынесены в common, чтобы контроллеры не использовали `any`
 * для @CurrentUser() / @Req() (GAP-39: no-explicit-any).
 */

/** req.user после UserAuthGuard (пользовательский JWT, aud=user). */
export interface UserActor {
  id: string
  role: string
  sessionId: string
}

/** req.user после AdminAuthGuard (админский JWT, aud=admin). */
export interface AdminActor {
  id: string
  role: string
  isAdmin: boolean
}

/**
 * req.user после AffiliateAuthGuard (партнёрский JWT, aud=affiliate).
 *
 * Отдельная форма по ключевому полю `affiliateId`, а не `id`: в affiliate-кабинете
 * id сущности — это affiliateId, а не userId. Смешивать их нельзя, иначе
 * партнёрский токен можно будет спутать с игровым (у того userId).
 */
export interface AffiliateActor {
  affiliateId: string
  email: string
}

declare module 'express-serve-static-core' {
  interface Request {
    /**
     * Кладут UserAuthGuard/OptionalAuthGuard (UserActor), AdminAuthGuard
     * (AdminActor) или AffiliateAuthGuard (AffiliateActor).
     */
    user?: UserActor | AdminActor | AffiliateActor
    /** Ставится RequestIdMiddleware (или pino genReqId раньше него). */
    id: string
  }
}
