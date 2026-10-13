import { createPublicKey, verify as cryptoVerify, type KeyObject } from 'crypto'

import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { errorMessage } from '@/common/utils/error-message'

import { type GoogleIdClaims, type IGoogleIdTokenVerifier } from '@modules/auth/domain/auth.ports'
import { OAuthNotConfiguredError, OAuthTokenInvalidError } from '@modules/auth/domain/errors'

/** Публичные ключи Google, которыми подписаны ID-токены (JWKS, RS256). */
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
const FETCH_TIMEOUT_MS = 10_000
/** Google отдаёт `Cache-Control: public, max-age=…`; свой TTL ограничиваем сверху. */
const DEFAULT_CACHE_MS = 6 * 60 * 60 * 1000
const MIN_REFRESH_MS = 5 * 60 * 1000
/** Как часто разрешена вынужденная загрузка JWKS из-за неизвестного kid. */
const FORCE_REFRESH_MIN_MS = 60_000
/**
 * Пауза после неудачного обращения к Google. Без неё каждый запрос с неизвестным
 * kid при недоступном JWKS (или с истёкшим кешем) шлёт новый HTTP-вызов с
 * 10-секундным таймаутом — исходящий трафик держат заблокированным, а лог тонет в
 * предупреждениях.
 */
const FAILURE_BACKOFF_MS = 60_000
/**
 * Потолок «протухания» кеша при недоступном Google. Без него отозванный Google
 * ключ принимался бы сколько угодно долго; 24 ч — компромисс: переживаем
 * короткий сбой/блокировку egress, но не живём на вчерашних ключах вечно.
 */
const MAX_STALE_MS = 24 * 60 * 60 * 1000
/**
 * Окно свежести `iat`. ID-токен живёт час и является предъявительским: украденный
 * (из логов, из чужого расширения) токен иначе оставался бы ключом к аккаунту весь
 * час. One Tap выдаёт токен в момент тапа, поэтому 10 минут — с запасом на медленный
 * сеть/диалог, но без лишнего окна.
 */
const MAX_TOKEN_AGE_MS = 10 * 60 * 1000
const CLOCK_SKEW_MS = 60_000
/** Оба значения Google допускает в `iss` — см. их руководство по проверке токена. */
const TRUSTED_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com'])
/** Алфавит base64url без padding: канон форма всех трёх сегментов JWS. */
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/

interface JwkKey {
  kid?: string
  kty?: string
  alg?: string
  n?: string
  e?: string
}

/**
 * Проверка ID-токена Google по JWKS.
 *
 * Порядок: структура → заголовок (alg/kid) → подпись ключом `kid` → claims.
 * Подпись сверяется ДО доверия содержимому: claims читаем только из токена,
 * подпись которого сошлась.
 */
@Injectable()
export class GoogleIdTokenVerifierService implements IGoogleIdTokenVerifier {
  private readonly logger = new Logger(GoogleIdTokenVerifierService.name)
  private keys = new Map<string, KeyObject>()
  private lastForcedAt = 0
  private lastFailureAt = 0
  private fetchedAt = 0
  private ttlMs = DEFAULT_CACHE_MS
  private inflight: Promise<void> | null = null

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  async verify(idToken: string): Promise<GoogleIdClaims> {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID')
    if (!clientId) {
      throw new OAuthNotConfiguredError('Google')
    }
    const parts = idToken.split('.')
    if (parts.length !== 3 || parts.some((part) => !BASE64URL_RE.test(part))) {
      // Символы вне алфавита base64url отбиваются здесь, а не «на глаз» при
      // декодировании: иначе один токен имеет несколько строковых форм
      // (`+`↔`-`, лишние `=`), и любой будущий дедуп по строке токена врёт.
      throw new OAuthTokenInvalidError('структура')
    }
    const [headerPart, payloadPart, signaturePart] = parts as [string, string, string]
    const kid = this.readKid(headerPart)
    const signingInput = Buffer.from(`${headerPart}.${payloadPart}`, 'ascii')
    const key = await this.keyForKid(kid)
    const signature = base64UrlToBuffer(signaturePart)
    if (!cryptoVerify('sha256', signingInput, key, signature)) {
      throw new OAuthTokenInvalidError('подпись')
    }
    return this.readClaims(payloadPart, clientId)
  }

  private readKid(headerPart: string): string {
    const header = decodeJsonSegment(headerPart)
    if (header['alg'] !== 'RS256') {
      throw new OAuthTokenInvalidError('алгоритм')
    }
    const kid = header['kid']
    if (typeof kid !== 'string' || kid === '') {
      throw new OAuthTokenInvalidError('kid')
    }
    return kid
  }

  private readClaims(payloadPart: string, clientId: string): GoogleIdClaims {
    const payload = decodeJsonSegment(payloadPart)
    this.assertAudience(payload, clientId)
    const subject = payload['sub']
    if (typeof subject !== 'string' || subject === '') {
      throw new OAuthTokenInvalidError('субъект')
    }
    this.assertTiming(payload, Date.now())
    const email = this.readEmail(payload)
    const name = payload['name']
    const nonce = payload['nonce']
    return {
      subject,
      email,
      ...(typeof name === 'string' && name !== '' ? { name } : {}),
      ...(typeof nonce === 'string' && nonce !== '' ? { nonce } : {}),
    }
  }

  /**
   * Кому токен выдан. `aud` обязан быть НАШ client id: чужой токен, выданный
   * другому приложению тем же Google, вход не открывает.
   *
   * `iss` сверяется только у строки: `String(['https://accounts.google.com'])`
   * дало бы то же значение, что и у настоящего значения, поэтому массив-издатель
   * прошёл бы проверку, хотя таким Google токены не выдаёт.
   */
  private assertAudience(payload: Record<string, unknown>, clientId: string): void {
    const issuer = payload['iss']
    if (typeof issuer !== 'string' || !TRUSTED_ISSUERS.has(issuer)) {
      throw new OAuthTokenInvalidError('издатель')
    }
    if (payload['aud'] !== clientId) {
      throw new OAuthTokenInvalidError('получатель')
    }
  }

  /** Почта — ключ линковки в `OAuthUserProvisioningService`, поэтому без неё нельзя. */
  private readEmail(payload: Record<string, unknown>): string {
    const email = payload['email']
    if (typeof email !== 'string' || email === '' || payload['email_verified'] !== true) {
      throw new OAuthTokenInvalidError('подтверждённая почта отсутствует')
    }
    return email
  }

  private assertTiming(payload: Record<string, unknown>, now: number): void {
    const exp = payload['exp']
    const iat = payload['iat']
    if (typeof exp !== 'number' || exp * 1000 + CLOCK_SKEW_MS <= now) {
      throw new OAuthTokenInvalidError('токен просрочен')
    }
    if (typeof iat !== 'number' || iat * 1000 > now + CLOCK_SKEW_MS) {
      throw new OAuthTokenInvalidError('выдан в будущем')
    }
    if (now - iat * 1000 > MAX_TOKEN_AGE_MS) {
      throw new OAuthTokenInvalidError('устарел')
    }
    const nbf = payload['nbf']
    if (typeof nbf === 'number' && nbf * 1000 > now + CLOCK_SKEW_MS) {
      // Google обычно не кладёт `nbf` в ID-токен, но если он появился — токен
      // «ещё не действует» принимать нельзя, как и просроченный.
      throw new OAuthTokenInvalidError('ещё не действует')
    }
  }

  /** Ключ по `kid`: из кеша, иначе — после обновления JWKS. */
  private async keyForKid(kid: string): Promise<KeyObject> {
    const cached = this.keys.get(kid)
    if (cached && !this.cacheExpired()) {
      return cached
    }
    await this.loadKeys()
    const afterPlanned = this.keys.get(kid)
    if (afterPlanned) {
      return afterPlanned
    }
    // Неизвестный kid — это ротация ключа у Google, а не атака: второй запрос на
    // него нужен. Частоту вынужденных загрузок ограничивает НЕ набор kid (наивный
    // Set обходился бы одним обращением к Google на каждый выдуманный kid), а
    // глобальный интервал: за его пределами — отказ того же «неизвестного ключа».
    if (!this.forcedRefreshAllowed()) {
      throw new OAuthTokenInvalidError('неизвестный ключ')
    }
    this.lastForcedAt = Date.now()
    await this.loadKeys(true)
    const rotated = this.keys.get(kid)
    if (!rotated) {
      throw new OAuthTokenInvalidError('неизвестный ключ')
    }
    return rotated
  }

  private cacheExpired(): boolean {
    return Date.now() - this.fetchedAt > this.ttlMs
  }

  private forcedRefreshAllowed(): boolean {
    return this.keys.size === 0 || Date.now() - this.lastForcedAt >= FORCE_REFRESH_MIN_MS
  }

  /**
   * Один параллельный запрос за ключами: шквал входов не должен превращаться в
   * шквал обращений к Google (и в state-race двух `this.keys = …` сразу).
   * Вынужденную загрузку ждём отдельно: если в этот момент идёт плановая, она
   * могла выйти по MIN_REFRESH и не принести новый ключ.
   */
  private async loadKeys(force = false): Promise<void> {
    if (this.inflight !== null) {
      await this.inflight
      if (force) {
        await this.fetchKeys(true)
      }
      return
    }
    this.inflight = this.fetchKeys(force).finally(() => {
      this.inflight = null
    })
    return this.inflight
  }

  private async fetchKeys(force: boolean): Promise<void> {
    const now = Date.now()
    // Свежий отказ: не долбим Google, пока не прошёл пауз. Держим то, что есть
    // (пустой кеш = отказ во входит, непустой = проверка старыми ключами).
    if (now - this.lastFailureAt < FAILURE_BACKOFF_MS) {
      return
    }
    // Плановое обновление — не чаще раза в MIN_REFRESH; вынужденное (неизвестный
    // kid) не ждём: его частоту ограничивает lastForcedAt в keyForKid.
    if (!force && this.keys.size > 0 && now - this.fetchedAt < MIN_REFRESH_MS) {
      return
    }
    const fetched = await this.requestKeys()
    if (!fetched.ok) {
      this.lastFailureAt = now
      this.afterFailedFetch(fetched.reason)
      return
    }
    const next = indexKeys(fetched.body.keys ?? [])
    if (next.size === 0) {
      this.lastFailureAt = now
      this.afterFailedFetch('пустой JWKS')
      return
    }
    this.keys = next
    this.fetchedAt = now
    this.ttlMs = readMaxAgeMs(fetched.res.headers.get('cache-control'))
  }

  /** Отказ или пустой ответ JWKS. */
  private afterFailedFetch(reason: string): void {
    const staleFor = Date.now() - this.fetchedAt
    if (this.keys.size === 0) {
      // Пустого кеша это не касается: там нечем проверять подпись.
      throw new OAuthTokenInvalidError(`ключи Google недоступны (${reason})`)
    }
    if (staleFor > MAX_STALE_MS) {
      // Старые ключи держим только в пределах разумного: иначе отозванный Google
      // ключ принимал бы токены сколько угодно долго при недоступном JWKS.
      throw new OAuthTokenInvalidError(`ключи Google устарели (${reason})`)
    }
    this.logger.warn(`JWKS обновить не удалось (${reason}), держим кеш ${staleFor} мс`)
  }

  /**
   * Сам запрос: сетевые и HTTP-неудачи возвращаем значением, а не исключением —
   * raw `Error` отсюда уехал бы в лог и в сообщение, а доменный отказ у нас один
   * (G17).
   */
  private async requestKeys(): Promise<
    { ok: true; res: Response; body: { keys?: JwkKey[] } } | { ok: false; reason: string }
  > {
    try {
      const res = await fetch(JWKS_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      if (!res.ok) {
        return { ok: false, reason: `HTTP ${res.status}` }
      }
      return { ok: true, res, body: (await res.json()) as { keys?: JwkKey[] } }
    } catch (e) {
      return { ok: false, reason: errorMessage(e) }
    }
  }
}

/** Набор пригодных к проверке ключей из ответа JWKS (не-RSA и неполные отсеиваются). */
function indexKeys(keys: JwkKey[]): Map<string, KeyObject> {
  const next = new Map<string, KeyObject>()
  for (const jwk of keys) {
    const key = toKeyObject(jwk)
    // Первый ключ с таким kid выигрывает: при дубле в ответе провайдера нам всё
    // равно, какой из двух подставлять, но результат должен быть детерминирован.
    if (key !== null && !next.has(key[0])) {
      next.set(key[0], key[1])
    }
  }
  return next
}

/** `kid → KeyObject`, либо null для не-RSA/неполного ключа. */
function toKeyObject(jwk: JwkKey): [string, KeyObject] | null {
  if (
    jwk.kty !== 'RSA' ||
    typeof jwk.kid !== 'string' ||
    typeof jwk.n !== 'string' ||
    typeof jwk.e !== 'string'
  ) {
    return null
  }
  if (jwk.alg !== undefined && jwk.alg !== 'RS256') {
    return null
  }
  try {
    return [
      jwk.kid,
      createPublicKey({
        key: { kty: 'RSA', kid: jwk.kid, n: jwk.n, e: jwk.e },
        format: 'jwk',
      }),
    ]
  } catch {
    return null
  }
}

function decodeJsonSegment(segment: string): Record<string, unknown> {
  const parsed = parseJsonObject(base64UrlToBuffer(segment).toString('utf8'))
  if (parsed === null) {
    throw new OAuthTokenInvalidError('сегмент JWT')
  }
  return parsed
}

/** Внешний payload: объект или null; чужую форму не угадываем (G17: без raw Error). */
function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text) as unknown
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function base64UrlToBuffer(value: string): Buffer {
  return Buffer.from(value, 'base64url')
}

/** `Cache-Control: max-age=N` → мс; без заголовка или с мусором — дефолт. */
function readMaxAgeMs(cacheControl: string | null): number {
  const match = /max-age=(\d+)/.exec(cacheControl ?? '')
  if (match === null) {
    return DEFAULT_CACHE_MS
  }
  const seconds = Number(match[1])
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return DEFAULT_CACHE_MS
  }
  return Math.min(seconds * 1000, DEFAULT_CACHE_MS)
}
