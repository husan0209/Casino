import { randomBytes } from 'crypto'

import { Inject, Injectable } from '@nestjs/common'

import { EmailAlreadyExistsError, WeakPasswordError } from '../../domain/errors'
import {
  ISessionRepository,
  SESSION_REPOSITORY,
} from '../../domain/repositories/session.repository'
import { IUserRepository, USER_REPOSITORY } from '../../domain/repositories/user.repository'
import {
  IEmailVerificationRepository,
  EMAIL_VERIFICATION_REPOSITORY,
} from '../../domain/repositories/verification-token.repository'
import { EmailQueueService } from '../../infrastructure/services/email-queue.service'
import { JwtTokenService } from '../../infrastructure/services/jwt.service'
import { PasswordHasher } from '../../infrastructure/services/password-hasher.service'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 8

@Injectable()
export class RegisterUseCase {
  // eslint-disable-next-line max-params -- Nest DI: состав конструктора задаётся графом зависимостей (GAP-25)
  constructor(
    @Inject(USER_REPOSITORY) private users: IUserRepository,
    @Inject(SESSION_REPOSITORY) private sessions: ISessionRepository,
    @Inject(EMAIL_VERIFICATION_REPOSITORY) private verif: IEmailVerificationRepository,
    private hasher: PasswordHasher,
    private email: EmailQueueService,
    private jwt: JwtTokenService,
  ) {}

  private async generateReferralCode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const bytes = randomBytes(CODE_LENGTH)
      let code = ''
      for (let i = 0; i < CODE_LENGTH; i++) {
        code += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length]
      }
      if (!(await this.users.referralCodeExists(code))) {
        return code
      }
    }
    throw new Error('REFERRAL_CODE_GENERATION_FAILED')
  }

  async execute(
    input: { email: string; password: string; referralCode?: string | undefined },
    meta?: { ip?: string | undefined; userAgent?: string | undefined },
  ) {
    if (input.password.length < 8) {
      throw new WeakPasswordError()
    }
    const emailNormalized = input.email.toLowerCase().trim()

    const existing = await this.users.findByEmail(emailNormalized)
    if (existing) {
      throw new EmailAlreadyExistsError()
    }

    let referredBy: string | null = null
    if (input.referralCode) {
      const referrer = await this.users.findByReferralCode(input.referralCode.toUpperCase().trim())
      if (referrer) {
        referredBy = referrer.id
      }
    }

    const passwordHash = await this.hasher.hash(input.password)
    const referralCode = await this.generateReferralCode()
    const user = await this.users.create({
      email: emailNormalized,
      passwordHash,
      referralCode,
      referredBy,
    })

    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000)
    await this.verif.create(user.id, token, expiresAt)
    await this.email.sendVerificationEmail(emailNormalized, token)

    const { token: refreshToken, hash } = this.jwt.generateRefreshToken()
    const sessionExpires = new Date(Date.now() + 30 * 24 * 3600 * 1000)
    const session = await this.sessions.create({
      userId: user.id,
      refreshTokenHash: hash,
      ipAddress: meta?.ip || null,
      userAgent: meta?.userAgent || null,
      expiresAt: sessionExpires,
      revokedAt: null,
    })
    const accessToken = this.jwt.signAccess(user.id, user.role, session.id)

    return {
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, role: user.role },
      referralCode,
      message: 'Регистрация успешна',
    }
  }
}
