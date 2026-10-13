import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { GOOGLE_NONCE_TTL_MS } from '@/common/cookies/google-nonce-cookie'

import {
  type GoogleIdClaims,
  GOOGLE_ID_TOKEN_VERIFIER,
  type IGoogleIdTokenVerifier,
} from '@modules/auth/domain/auth.ports'
import {
  OAuthNotConfiguredError,
  OAuthStateError,
  OAuthTokenInvalidError,
} from '@modules/auth/domain/errors'

import {
  OAuthUserProvisioningService,
  type OAuthSignInResult,
} from './oauth-user-provisioning.service'

/**
 * Метка назначения в подписанном значении. `state` code-flow
 * (google-oauth.use-case.ts) подписывается тем же `JWT_ACCESS_SECRET` и в той же
 * форме `body.signature`. Одной метки мало: `verifyState` лишнее поле молча
 * игнорирует, поэтому ключ для nonce ещё и выводятся отдельно (`deriveKey`) —
 * подпись одного назначения не проходит для другого ни в одну сторону.
 */
const NONCE_PURPOSE = 'otn'
/** Контекст вывода ключа: тот же секрет, но подпись непереносима между целями. */
const NONCE_KEY_CONTEXT = 'google-one-tap-nonce'
/** Запас на расхождение часов сервера: значение `t` из будущего на пару секунд — не атака. */
const CLOCK_SKEW_MS = 60_000

interface NoncePayload {
  /** Назначение подписи. */
  p: string
  /** Время выдачи, мс. Даёт окну `GOOGLE_NONCE_TTL_MS`. */
  t: number
  /** Случайные 16 байт — их Google кладёт в ID-токен. */
  n: string
}

/**
 * Google One Tap (credential-поток): браузер отдаёт нам подписанный Google
 * ID-токен, мы обмениваем его на сессию.
 *
 * Отличие от authorization code flow не в схеме аккаунта — `sub` в ID-токене и в
 * `userinfo` один и тот же, поэтому игрок, вошедший по кнопке и по One Tap,
 * попадает в одну и ту же связку в `auth_providers`. Отличие в том, что токен
 * приходит сам, без редиректа, и является предъявительским: кто принёс — тот и
 * вошёл. Поэтому здесь два обязательных условия, без которых поток был бы
 * дырой: криптографическая проверка токена (`GoogleIdTokenVerifierService`) и
 * привязка к браузеру через nonce в httpOnly-куке — см. google-nonce-cookie.ts.
 */
@Injectable()
export class GoogleOneTapUseCase {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(GOOGLE_ID_TOKEN_VERIFIER) private readonly verifier: IGoogleIdTokenVerifier,
    @Inject(OAuthUserProvisioningService)
    private readonly provisioning: OAuthUserProvisioningService,
  ) {}

  /**
   * Выдать браузеру nonce до показа подсказки. Два значения не взаимозаменяемы:
   * `value` уходит клиенту и через Google попадает в ID-токен, `cookie` —
   * подписанный конверт (значение + возраст), который живёт только в
   * httpOnly-куке. Отдать конверт наружу означало бы выдать странице и ожидаемое
   * значение, и заготовку для подстановки в другом браузере.
   */
  issueNonce(): { value: string; cookie: string } {
    const payload: NoncePayload = {
      p: NONCE_PURPOSE,
      t: Date.now(),
      n: randomBytes(16).toString('base64url'),
    }
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
    return { value: payload.n, cookie: `${body}.${this.sign(body)}` }
  }

  async execute(input: {
    credential: string
    /** Значение `g_one_tap` из куки браузера, начавшего вход. */
    nonceCookie?: string | undefined
    referralCode?: string | undefined
    ip?: string | undefined
    userAgent?: string | undefined
  }): Promise<OAuthSignInResult> {
    const expectedNonce = this.readNonceCookie(input.nonceCookie)
    const claims: GoogleIdClaims = await this.verifier.verify(input.credential)
    if (claims.nonce !== expectedNonce) {
      // Токен выпущен для другого начала входа (или без nonce вовсе).
      throw new OAuthTokenInvalidError('nonce')
    }
    return this.provisioning.signIn({
      provider: 'google',
      providerUserId: claims.subject,
      email: claims.email,
      displayName: claims.name,
      referralCode: input.referralCode,
      ip: input.ip,
      userAgent: input.userAgent,
    })
  }

  /**
   * Ключ подписи nonce: `JWT_ACCESS_SECRET`, пропущенный через контекст-метку.
   * Пустой секрет означал бы подпись, которую подделывает кто угодно, — поэтому
   * падаем, а не подписываем «чем попало». Отдельный вывод ключа нужен потому, что
   * `verifyState` в code-flow лишние поля игнорирует: без разного ключа конверт
   * nonce был бы годным `state` (и наоборот) при одном и том же секрете.
   */
  private signingSecret(): string {
    const secret = this.config.get<string>('JWT_ACCESS_SECRET')
    if (secret === undefined || secret === '') {
      throw new OAuthNotConfiguredError('Google')
    }
    return createHmac('sha256', secret).update(NONCE_KEY_CONTEXT).digest('base64url')
  }

  private sign(body: string): string {
    return createHmac('sha256', this.signingSecret()).update(body).digest('base64url')
  }

  /** Проверка подписи и возраста куки; возвращает вложенный nonce. */
  private readNonceCookie(cookie: string | undefined): string {
    const payload = this.readSignedPayload(cookie)
    if (typeof payload.n !== 'string' || payload.n === '') {
      throw new OAuthStateError()
    }
    if (Date.now() - payload.t > GOOGLE_NONCE_TTL_MS) {
      throw new OAuthStateError()
    }
    return payload.n
  }

  /**
   * Разбор подписанного значения: подпись → возраст. Формы отказа не различаются
   * наружу (везде `OAUTH_STATE_INVALID`): клиенту нечем пользоваться, а вот
   * различие помогло бы подбирать подписи по ответу.
   */
  private readSignedPayload(cookie: string | undefined): NoncePayload {
    if (cookie === undefined || cookie === '') {
      throw new OAuthStateError()
    }
    const separator = cookie.indexOf('.')
    if (separator <= 0) {
      throw new OAuthStateError()
    }
    const body = cookie.slice(0, separator)
    if (!this.signatureMatches(body, cookie.slice(separator + 1))) {
      throw new OAuthStateError()
    }
    let payload: NoncePayload
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as NoncePayload
    } catch {
      throw new OAuthStateError()
    }
    if (typeof payload.t !== 'number' || payload.p !== NONCE_PURPOSE) {
      // Чужое назначение (например подпись `state` из code-flow) — не nonce.
      throw new OAuthStateError()
    }
    if (payload.t - Date.now() > CLOCK_SKEW_MS) {
      // Выдан «из будущего»: терпим только расхождение часов.
      throw new OAuthStateError()
    }
    return payload
  }

  private signatureMatches(body: string, received: string): boolean {
    const expected = this.sign(body)
    const a = Buffer.from(received)
    const b = Buffer.from(expected)
    return a.length === b.length && timingSafeEqual(a, b)
  }
}
