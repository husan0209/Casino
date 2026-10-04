import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { OAUTH_STATE_TTL_MS } from '@/common/cookies/oauth-state-cookie'
import { errorMessage } from '@/common/utils/error-message'

import {
  OAuthNotConfiguredError,
  OAuthStateError,
  OAuthExchangeError,
  OAuthUpstreamError,
} from '@modules/auth/domain/errors'

import {
  OAuthUserProvisioningService,
  type OAuthSignInResult,
} from './oauth-user-provisioning.service'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'

interface StatePayload {
  /** Время выдачи, мс. Даёт окну 10 минут (OAUTH_STATE_TTL_MS). */
  t: number
  /**
   * Nonce — уникальность выдачи. Без него `state` = HMAC от одного таймстемпа,
   * и два входа, начатые в одну миллисекунду (или атакующий, крутящий
   * `/auth/google/url` в цикле), получают ОДИНАКОВУЮ строку. Тогда привязка
   * `state` к куке перестаёт что-либо доказывать: чужой state совпадёт со своим
   * по значению, и login CSRF пройдёт.
   */
  n: string
}

/**
 * Google OAuth 2.0 (authorization code flow) — TZ part 2 §OAuth.
 * GET /auth/google/url → { url, state }; POST /auth/google {code, redirect_uri, state} → сессия.
 */
@Injectable()
export class GoogleOAuthUseCase {
  constructor(
    @Inject(ConfigService) private config: ConfigService,
    @Inject(OAuthUserProvisioningService) private provisioning: OAuthUserProvisioningService,
  ) {}

  private credentials(): { clientId: string; clientSecret: string } {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID')
    const clientSecret = this.config.get<string>('GOOGLE_CLIENT_SECRET')
    if (!clientId || !clientSecret) {
      throw new OAuthNotConfiguredError('Google')
    }
    return { clientId, clientSecret }
  }

  private signState(): string {
    const payload: StatePayload = { t: Date.now(), n: randomBytes(16).toString('base64url') }
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const sig = createHmac('sha256', this.config.get<string>('JWT_ACCESS_SECRET')!)
      .update(body)
      .digest('base64url')
    return `${body}.${sig}`
  }

  /**
   * Проверка `state`: подпись + возраст + привязка к браузеру.
   *
   * Подпись (HMAC по таймстемпу) доказывает, что `state` выдал наш сервер, но НЕ
   * доказывает, что его принёс тот же клиент, который начал вход. `GET
   * /auth/google/url` анонимный, поэтому без сверки с кукой пара `(code, state)`
   * от атакующего логинит жертву в аккаунт атакующего (login CSRF). Требование
   * `stateCookie === state` замыкает цепочку; совпадение строгое, потому что
   * значение не секрет, а идентификатор сеанса входа — нормализация здесь только
   * расширяла бы окно подмены.
   */
  private verifyState(state: string | undefined, stateCookie: string | undefined): void {
    if (!state) {
      throw new OAuthStateError()
    }
    if (!stateCookie || stateCookie !== state) {
      throw new OAuthStateError()
    }
    const [body, sig] = state.split('.') as [string, string]
    const expected = createHmac('sha256', this.config.get<string>('JWT_ACCESS_SECRET')!)
      .update(body)
      .digest('base64url')
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new OAuthStateError()
    }
    const { t } = JSON.parse(Buffer.from(body, 'base64url').toString()) as { t: number }
    if (Date.now() - t > OAUTH_STATE_TTL_MS) {
      throw new OAuthStateError()
    }
  }

  buildAuthUrl(redirectUri?: string): { url: string; state: string } {
    const { clientId } = this.credentials()
    const redirect = redirectUri || `${this.config.get<string>('APP_URL')}/auth/google/callback`
    const state = this.signState()
    const q = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirect,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    })
    return { url: `${AUTH_URL}?${q.toString()}`, state }
  }

  async execute(input: {
    code: string
    redirectUri?: string | undefined
    state?: string | undefined
    /** Значение `oauth_state` из куки браузера, начавшего вход. */
    stateCookie?: string | undefined
    referralCode?: string | undefined
    ip?: string | undefined
    userAgent?: string | undefined
  }): Promise<OAuthSignInResult> {
    const { clientId, clientSecret } = this.credentials()
    this.verifyState(input.state, input.stateCookie)
    const redirect =
      input.redirectUri || `${this.config.get<string>('APP_URL')}/auth/google/callback`

    let email: string | undefined
    let providerUserId: string
    try {
      const tokenRes = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: input.code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirect,
          grant_type: 'authorization_code',
        }),
      })
      if (!tokenRes.ok) {
        throw new OAuthUpstreamError(`token ${tokenRes.status}`)
      }
      const { access_token } = (await tokenRes.json()) as { access_token?: string }
      if (!access_token) {
        throw new OAuthUpstreamError('no access_token')
      }

      const uiRes = await fetch(USERINFO_URL, {
        headers: { Authorization: `Bearer ${access_token}` },
      })
      if (!uiRes.ok) {
        throw new OAuthUpstreamError(`userinfo ${uiRes.status}`)
      }
      const ui = (await uiRes.json()) as { sub: string; email?: string; email_verified?: boolean }
      providerUserId = ui.sub
      if (!ui.email || ui.email_verified === false) {
        throw new OAuthUpstreamError('email not available/verified')
      }
      email = ui.email
    } catch (e) {
      throw new OAuthExchangeError(errorMessage(e))
    }

    return this.provisioning.signIn({
      provider: 'google',
      providerUserId,
      email,
      referralCode: input.referralCode,
      ip: input.ip,
      userAgent: input.userAgent,
    })
  }
}
