import { randomBytes } from 'node:crypto'

import { Inject, Injectable } from '@nestjs/common'

import { AUTH_PROVIDER_REPOSITORY, type AuthProviderKind, type IAuthProviderRepository } from '@modules/auth/domain/repositories/auth-provider.repository'
import { type ISessionRepository, SESSION_REPOSITORY } from '@modules/auth/domain/repositories/session.repository'
import { type IUserRepository, USER_REPOSITORY } from '@modules/auth/domain/repositories/user.repository'
import { type JwtTokenService } from '@modules/auth/infrastructure/services/jwt.service'

import { type User } from '../../../domain/entities/user.entity'

/** Результат OAuth-входа: access/refresh + данные игрока. */
export interface OAuthSignInResult {
  accessToken: string
  refreshToken: string
  user: { id: string; email: string | null; role: string }
  wasLinked: boolean
}

export interface ProviderSignInInput {
  provider: AuthProviderKind
  providerUserId: string
  /** email от провайдера (у Telegram его нет) */
  email?: string | null
  displayName?: string | undefined
  referralCode?: string | undefined
  ip?: string | undefined
  userAgent?: string | undefined
}

/**
 * Общий вход/регистрация через внешнего провайдера (UC-OAUTH):
 * 1. ищем связь в auth_providers;
 * 2. если нет — линкуем по email (Google) или создаём нового пользователя
 *    без пароля + реферальный код (UC-REF-01/02);
 * 3. выдаём сессию как обычный логин.
 */
@Injectable()
export class OAuthUserProvisioningService {
  // eslint-disable-next-line max-params -- Nest DI: состав конструктора задаётся графом зависимостей (GAP-25)
  constructor(
    @Inject(USER_REPOSITORY) private users: IUserRepository,
    @Inject(AUTH_PROVIDER_REPOSITORY) private authProviders: IAuthProviderRepository,
    @Inject(SESSION_REPOSITORY) private sessions: ISessionRepository,
    private jwt: JwtTokenService,
  ) {}

  private async generateReferralCode(): Promise<string> {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    for (let attempt = 0; attempt < 5; attempt++) {
      const bytes = randomBytes(8)
      let code = ''
      for (let i = 0; i < 8; i++) {
        code += alphabet[bytes[i]! % alphabet.length]
      }
      if (!(await this.users.referralCodeExists(code))) {
        return code
      }
    }
    throw new Error('REFERRAL_CODE_GENERATION_FAILED')
  }

  async signIn(input: ProviderSignInInput): Promise<OAuthSignInResult> {
    let link = await this.authProviders.findByProvider(input.provider, input.providerUserId)
    const wasLinked = Boolean(link)
    let user = link ? await this.users.findById(link.userId) : null

    if (!user && input.email) {
      user = await this.users.findByEmail(input.email.toLowerCase().trim())
    }
    if (!user) {
      user = await this.provisionUser(input)
    }
    if (!link) {
      link = await this.authProviders.create({
        userId: user.id,
        provider: input.provider,
        providerUserId: input.providerUserId,
        providerEmail: input.email ?? undefined,
        providerData: input.displayName ? { display_name: input.displayName } : undefined,
      })
    }

    const { token: refreshToken, hash } = this.jwt.generateRefreshToken()
    const session = await this.sessions.create({
      userId: user.id,
      refreshTokenHash: hash,
      ipAddress: input.ip || null,
      userAgent: input.userAgent || null,
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      revokedAt: null,
    })
    const accessToken = this.jwt.signAccess(user.id, user.role, session.id)

    return {
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, role: user.role },
      wasLinked,
    }
  }

  /** Создание игрока при первом входе через провайдера (без пароля, с реферальным кодом). */
  private async provisionUser(input: ProviderSignInInput): Promise<User> {
    const referralCode = await this.generateReferralCode()
    let referredBy: string | null = null
    if (input.referralCode) {
      const referrer = await this.users.findByReferralCode(input.referralCode.toUpperCase().trim())
      if (referrer) {
        referredBy = referrer.id
      }
    }
    return this.users.create({
      email: input.email ? input.email.toLowerCase().trim() : null,
      passwordHash: null,
      referralCode,
      referredBy,
    })
  }
}
