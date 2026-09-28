/** Порты auth-сервисов (решение В5: application-слой работает с infrastructure
 * только через интерфейсы + DI-токены — по образцу payments.ports.ts и
 * maintenance.ports.ts).
 *
 * Контракты повторяют публичную поверхность классов infrastructure/services 1:1;
 * сами классы остаются в infrastructure и получают `implements`. Исключение —
 * типы капчи: это контракт, поэтому живут здесь (infrastructure импортирует их
 * из domain — направление разрешено MODULE_BOUNDARIES §16.1).
 */

import type { EnqueueResult } from '@/queues/queue.types'

/** Хеширование паролей (argon2id) — register / login / смена и сброс пароля. */
export interface IPasswordHasher {
  hash(plain: string): Promise<string>
  verify(hash: string, plain: string): Promise<boolean>
}

/** HS256 JWT и refresh-токены (STACK.md «JWT: HS256 MVP») — см. jwt.service.ts. */
export interface IJwtTokenService {
  signAccess(userId: string, role: string, sessionId: string): string
  verifyAccess(token: string): { sub: string; role: string; session_id: string }
  /** Refresh token: случайные 512 бит; в БД хранится только SHA-256 хеш. */
  generateRefreshToken(): { token: string; hash: string }
  hashRefreshToken(token: string): string
}

/** Продюсер писей аутентификации (verify-email / reset-password) — очередь `email`. */
export interface IEmailQueueService {
  sendVerificationEmail(to: string, token: string): Promise<EnqueueResult>
  sendPasswordReset(to: string, token: string): Promise<EnqueueResult>
}

/** Ответ siteverify Cloudflare Turnstile. */
export interface CaptchaVerifyResponse {
  success: boolean
  'error-codes'?: string[]
}

/** Подменяемый транспорт siteverify — тесты не должны бить по сети. */
export type CaptchaTransport = (url: string, init: RequestInit) => Promise<CaptchaVerifyResponse>

/** Cloudflare Turnstile (GAP-55 (ж), ТЗ ч.5 §5.2): капча после порога неудач. */
export interface ICaptchaService {
  /** Транспорт siteverify; подменяется в тестах. */
  transport: CaptchaTransport
  readonly siteKey: string
  /** enabled = есть И siteKey, И secretKey (иначе механизм выключен). */
  readonly enabled: boolean
  /** Порог неудач до капчи (ТЗ §5.2 — 5). */
  readonly threshold: number
  /** Обязательна ли капча при текущем счётчике неудач. */
  isRequiredFor(failedAttempts: number): boolean
  verify(token: string | undefined): Promise<void>
}

/** DI-токены портов auth для Nest-DI. */
export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER')
export const JWT_TOKEN_SERVICE = Symbol('JWT_TOKEN_SERVICE')
export const EMAIL_QUEUE_SERVICE = Symbol('EMAIL_QUEUE_SERVICE')
export const CAPTCHA_SERVICE = Symbol('CAPTCHA_SERVICE')
