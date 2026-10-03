/**
 * Порты infrastructure-сервисов партнёрской программы (решение В5:
 * application-слой работает с infrastructure только через интерфейсы +
 * DI-токены — по образцу auth.ports.ts и casino.ports.ts).
 *
 * Контракт повторяет публичную поверхность класса AffiliateJwtService
 * (infrastructure/affiliate-jwt.service.ts); сам класс остаётся в
 * infrastructure и получает `implements`. Тип payload — часть контракта,
 * поэтому живёт здесь, а infrastructure импортирует его из domain
 * (направление разрешено MODULE_BOUNDARIES §16.1).
 */

/** Разобранный партнёрский токен. */
export interface AffiliateTokenPayload {
  sub: string
  email: string
  aud: string
  iat: number
  exp: number
  iss: string
}

/**
 * JWT партнёров — ОТДЕЛЬНАЯ аудитория (`aud: 'affiliate'`) и отдельный секрет:
 * player- и admin-токены не должны открывать партнёрский кабинет (ТЗ ч.8 §16).
 *
 * Порт нужен, чтобы use case не знал ни про HMAC, ни про то, откуда берётся
 * секрет и что происходит в production при слабом AFFILIATE_JWT_SECRET.
 */
export interface IAffiliateJwtService {
  /** Access-токен партнёра. `sub` = affiliateId. */
  signAccess(affiliateId: string, email: string): string
  /**
   * Верификация access-токена. Наружу не отдаётся причина дефекта (подпись,
   * чужой aud, истёкший срок) — иначе атакующий понимает, что именно не так.
   */
  verifyAccess(token: string): AffiliateTokenPayload
  /** Refresh-токен: 512 бит случайности. В БД хранится ТОЛЬКО SHA-256 хеш. */
  generateRefreshToken(): { token: string; hash: string }
  hashRefreshToken(token: string): string
}

/** DI-токен порта JWT партнёров для Nest-DI. */
export const AFFILIATE_JWT_SERVICE = Symbol('AFFILIATE_JWT_SERVICE')
