import { randomBytes } from 'crypto'

import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { type ModuleRef } from '@nestjs/core'

import { errorMessage } from '@/common/utils/error-message'

// Импорт ТОЛЬКО класса-токена для ModuleRef.get. Это не зависимость Nest-модулей:
// affiliate.module по-прежнему не импортируется из AuthModule, цикла нет.
import { AffiliateFacade as AffiliateFacadeRef } from '../../../affiliate/facade/affiliate.facade'
import {
  EMAIL_QUEUE_SERVICE,
  type IEmailQueueService,
  type IPasswordHasher,
  type IJwtTokenService,
  PASSWORD_HASHER,
  JWT_TOKEN_SERVICE,
} from '../../domain/auth.ports'
import { type UserRole } from '../../domain/entities/user.entity'
import {
  EmailAlreadyExistsError,
  ReferralCodeGenerationError,
  WeakPasswordError,
} from '../../domain/errors'
import {
  type ISessionRepository,
  SESSION_REPOSITORY,
} from '../../domain/repositories/session.repository'
import { type IUserRepository, USER_REPOSITORY } from '../../domain/repositories/user.repository'
import {
  EMAIL_VERIFICATION_REPOSITORY,
  type IEmailVerificationRepository,
} from '../../domain/repositories/verification-token.repository'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 8

@Injectable()
export class RegisterUseCase {
  private readonly logger = new Logger(RegisterUseCase.name)

  constructor(
    @Inject(USER_REPOSITORY) private users: IUserRepository,
    @Inject(SESSION_REPOSITORY) private sessions: ISessionRepository,
    @Inject(EMAIL_VERIFICATION_REPOSITORY) private verif: IEmailVerificationRepository,
    @Inject(PASSWORD_HASHER) private hasher: IPasswordHasher,
    @Inject(EMAIL_QUEUE_SERVICE) private email: IEmailQueueService,
    @Inject(JWT_TOKEN_SERVICE) private jwt: IJwtTokenService,
    // Атрибуция к партнёру (партнёрская программа, ТЗ ч.8 §7.3).
    //
    // ПОЧЕМУ ModuleRef, А НЕ AffiliateFacade ЧЕРЕЗ ИМПОРТ: affiliate уже
    // импортирует AuthModule (нужны AuthGuard/RolesGuard). Прямой импорт
    // AffiliateModule в AuthModule создал бы цикл модулей, который
    // MODULE_BOUNDARIES §16.4 запрещает. ModuleRef резолвит провайдер
    // лениво по всему графу, без статической зависимости — стандартный
    // приём Nest именно для таких случаев. Optional: если affiliate-модуль
    // не подключён, регистрация всё равно должна работать.
    @Optional() private moduleRef?: ModuleRef,
  ) {}

  /**
   * Привязывает нового игрока к партнёру по коду из ?ref=.
   *
   * Полностью best-effort: отсутствие affiliate-модуля, отсутствие кода или
   * любая ошибка внутри — не влияют на успех регистрации. Игрок не должен
   * терять регистрацию из-за партнёрского контура.
   */
  private async attributePlayerToAffiliate(input: {
    playerId: string
    trackingCode?: string | undefined
    ip?: string | undefined
    userAgent?: string | undefined
  }): Promise<void> {
    if (this.moduleRef === undefined || input.trackingCode === undefined) {
      return
    }
    try {
      // strict: false ищет провайдер по всему графу приложения, а не только
      // в контейнере AuthModule.
      const facade = this.moduleRef.get(AffiliateFacadeRef, { strict: false }) as {
        attributePlayer: (args: typeof input) => Promise<unknown>
      }
      await facade.attributePlayer(input)
    } catch (err) {
      this.logger.warn(
        `Affiliate attribution skipped for player=${input.playerId}: ${errorMessage(err)}`,
      )
    }
  }

  /**
   * id реферера по коду из тела регистрации (игровая рефералка, не партнёрская).
   * Неизвестный код игнорируется: регистрация не должна падать из-за мусора.
   */
  private async resolveReferrerId(referralCode: string | undefined): Promise<string | null> {
    if (referralCode === undefined) {
      return null
    }
    const referrer = await this.users.findByReferralCode(referralCode.toUpperCase().trim())
    return referrer?.id ?? null
  }

  /** Токен подтверждения email + письмо (вынесено ради лимита 60 строк). */
  private async sendVerification(userId: string, email: string): Promise<void> {
    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000)
    await this.verif.create(userId, token, expiresAt)
    await this.email.sendVerificationEmail(email, token)
  }

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
    throw new ReferralCodeGenerationError()
  }

  async execute(
    input: { email: string; password: string; referralCode?: string | undefined },
    meta?: {
      ip?: string | undefined
      userAgent?: string | undefined
      /** Код партнёра из ?ref= (партнёрская программа, ТЗ ч.8 §7.3). */
      affiliateCode?: string | undefined
    },
  ): Promise<{
    accessToken: string
    refreshToken: string
    user: { id: string; email: string | null; role: UserRole }
    referralCode: string
    message: string
  }> {
    if (input.password.length < 8) {
      throw new WeakPasswordError()
    }
    const emailNormalized = input.email.toLowerCase().trim()

    const existing = await this.users.findByEmail(emailNormalized)
    if (existing) {
      throw new EmailAlreadyExistsError()
    }

    const referredBy = await this.resolveReferrerId(input.referralCode)
    const passwordHash = await this.hasher.hash(input.password)
    const referralCode = await this.generateReferralCode()
    const user = await this.users.create({
      email: emailNormalized,
      passwordHash,
      referralCode,
      referredBy,
    })

    // Привязка к партнёру (партнёрская программа). Вызывается ПОСЛЕ создания
    // игрока. Ошибка атрибуции не должна ломать регистрацию — игрок зарегистрировался
    // в любом случае, просто без привязки к партнёру.
    await this.attributePlayerToAffiliate({
      playerId: user.id,
      trackingCode: meta?.affiliateCode,
      ip: meta?.ip,
      userAgent: meta?.userAgent,
    })

    await this.sendVerification(user.id, emailNormalized)
    const { token: refreshToken, hash } = this.jwt.generateRefreshToken()
    const session = await this.sessions.create({
      userId: user.id,
      refreshTokenHash: hash,
      ipAddress: meta?.ip || null,
      userAgent: meta?.userAgent || null,
      expiresAt: this.jwt.refreshLifetime().expiresAt,
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
