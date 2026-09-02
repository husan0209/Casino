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
