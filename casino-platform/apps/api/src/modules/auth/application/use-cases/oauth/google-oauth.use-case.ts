import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHmac, timingSafeEqual } from 'crypto'
import { OAuthUserProvisioningService } from './oauth-user-provisioning.service'
import { OAuthNotConfiguredError, OAuthStateError, OAuthExchangeError } from '../../../domain/errors'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'

interface StatePayload { t: number; sig: string }

/**
 * Google OAuth 2.0 (authorization code flow) — TZ part 2 §OAuth.
 * GET /auth/google/url → { url, state }; POST /auth/google {code, redirect_uri, state} → сессия.
 */
@Injectable()
export class GoogleOAuthUseCase {
  constructor(
    private config: ConfigService,
    private provisioning: OAuthUserProvisioningService,
  ) {}

  private credentials() {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID')
    const clientSecret = this.config.get<string>('GOOGLE_CLIENT_SECRET')
    if (!clientId || !clientSecret) throw new OAuthNotConfiguredError('Google')
    return { clientId, clientSecret }
  }

  private signState(): string {
    const payload: StatePayload = { t: Date.now(), sig: '' }
    const body = Buffer.from(JSON.stringify({ t: payload.t })).toString('base64url')
    const sig = createHmac('sha256', this.config.get<string>('JWT_ACCESS_SECRET')!).update(body).digest('base64url')
    return `${body}.${sig}`
  }

  private verifyState(state?: string) {
    if (!state) throw new OAuthStateError()
    const [body, sig] = state.split('.') as [string, string]
    const expected = createHmac('sha256', this.config.get<string>('JWT_ACCESS_SECRET')!).update(body).digest('base64url')
    const a = Buffer.from(sig); const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new OAuthStateError()
    const { t } = JSON.parse(Buffer.from(body, 'base64url').toString()) as { t: number }
    if (Date.now() - t > 10 * 60 * 1000) throw new OAuthStateError()
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

  async execute(input: { code: string; redirectUri?: string | undefined; state?: string | undefined; referralCode?: string | undefined; ip?: string | undefined; userAgent?: string | undefined }) {
    const { clientId, clientSecret } = this.credentials()
    this.verifyState(input.state)
    const redirect = input.redirectUri || `${this.config.get<string>('APP_URL')}/auth/google/callback`

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
      if (!tokenRes.ok) throw new Error(`token ${tokenRes.status}`)
      const { access_token } = (await tokenRes.json()) as { access_token?: string }
      if (!access_token) throw new Error('no access_token')

      const uiRes = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${access_token}` } })
      if (!uiRes.ok) throw new Error(`userinfo ${uiRes.status}`)
      const ui = (await uiRes.json()) as { sub: string; email?: string; email_verified?: boolean }
      providerUserId = ui.sub
      if (!ui.email || ui.email_verified === false) throw new Error('email not available/verified')
      email = ui.email
    } catch (e: any) {
      throw new OAuthExchangeError(e?.message)
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
