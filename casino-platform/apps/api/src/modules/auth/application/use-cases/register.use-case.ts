import { randomBytes } from 'crypto'

import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { type ModuleRef } from '@nestjs/core'

import { errorMessage } from '@/common/utils/error-message'

import {
  CONSENTED_ON_REGISTRATION,
  LEGAL_DOCUMENT_VERSIONS,
  type LegalDocumentType,
} from '@casino/shared-types'


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
import { type User, type UserRole } from '../../domain/entities/user.entity'
import {
  EmailAlreadyExistsError,
  ReferralCodeGenerationError,
  TermsVersionOutdatedError,
  WeakPasswordError,
} from '../../domain/errors'
import {
  type ISessionRepository,
  SESSION_REPOSITORY,
} from '../../domain/repositories/session.repository'
import {
  type ITermsAcceptanceRepository,
  TERMS_ACCEPTANCE_REPOSITORY,
} from '../../domain/repositories/terms-acceptance.repository'
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
    // GAP-71: журнал акцепта. Обязательная зависимость, а не Optional:
    // регистрация без записи согласия означает, что доказательств акцепта нет,
    // и весь документ (Terms §4, §23) не работает.
    @Inject(TERMS_ACCEPTANCE_REPOSITORY) private acceptances: ITermsAcceptanceRepository,
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

  /**
   * Клиент присылает версию, которую реально отрендерил (она же — в реестре
   * shared-types). Если сервер и web разошлись по версиям, регистрировать
   * игрока под «нашей» версией нельзя: в журнале окажется документ, которого он
   * не видел. Поэтому устаревшему клиенту — отказ с явной просьбой обновиться.
   */
  private assertTermsVersionIsCurrent(termsVersion: string): void {
    if (termsVersion !== LEGAL_DOCUMENT_VERSIONS.terms) {
      throw new TermsVersionOutdatedError(LEGAL_DOCUMENT_VERSIONS.terms)
    }
  }

  /**
   * Записывает согласие по каждому документу отдельной строкой (Terms §4).
   * Версии берутся из серверного реестра, а не из тела запроса, — assert выше
   * гарантирует, что присланная версия ему равна.
   */
  private async recordRegistrationConsent(input: {
    userId: string
    ip?: string | undefined
    userAgent?: string | undefined
  }): Promise<void> {
    const entries = CONSENTED_ON_REGISTRATION.map((document: LegalDocumentType) => ({
      userId: input.userId,
      document,
      version: LEGAL_DOCUMENT_VERSIONS[document],
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    }))
    await this.acceptances.recordMany(entries)
  }

  /**
   * Создаёт игрока: хеш пароля, уникальный реферальный код, связь с пригласившим.
   * Вынесено из execute, чтобы тело регистрации осталось списком шагов.
   */
  private async createPlayer(input: {
    email: string
    password: string
    referredBy: string | null
  }): Promise<User> {
    const passwordHash = await this.hasher.hash(input.password)
    const referralCode = await this.generateReferralCode()
    return this.users.create({
      email: input.email,
      passwordHash,
      referralCode,
      referredBy: input.referredBy,
    })
  }

  async execute(
    input: {
      email: string
      password: string
      referralCode?: string | undefined
      termsVersion: string
    },
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
    this.assertTermsVersionIsCurrent(input.termsVersion)
    const emailNormalized = input.email.toLowerCase().trim()

    const existing = await this.users.findByEmail(emailNormalized)
    if (existing) {
      throw new EmailAlreadyExistsError()
    }

    const referredBy = await this.resolveReferrerId(input.referralCode)
    const user = await this.createPlayer({
      email: emailNormalized,
      password: input.password,
      referredBy,
    })

    // Журнал акцепта — сразу после создания игрока и до всего best-effort-ного:
    // отказ последующих шагов не должен оставлять регистрацию без согласия.
    await this.recordRegistrationConsent({
      userId: user.id,
      ip: meta?.ip,
      userAgent: meta?.userAgent,
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
    const tokens = await this.openSession({
      userId: user.id,
      role: user.role,
      ip: meta?.ip,
      userAgent: meta?.userAgent,
    })

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: { id: user.id, email: user.email, role: user.role },
      referralCode: user.referralCode,
      message: 'Регистрация успешна',
    }
  }

  /**
   * Сессия сразу после регистрации (§5.1: игрок входит, письмо подтверждает
   * фоном). Вынесено из execute, чтобы тело регистрации читалось как список
   * шагов. Окно refresh берётся из конфига (jwt.refreshLifetime), а не из
   * литерала в коде: оно обязано совпадать с тем, что проверяет refresh-путь.
   */
  private async openSession(input: {
    userId: string
    role: UserRole
    ip?: string | undefined
    userAgent?: string | undefined
  }): Promise<{ accessToken: string; refreshToken: string }> {
    const { token: refreshToken, hash } = this.jwt.generateRefreshToken()
    const session = await this.sessions.create({
      userId: input.userId,
      refreshTokenHash: hash,
      ipAddress: input.ip || null,
      userAgent: input.userAgent || null,
      expiresAt: this.jwt.refreshLifetime().expiresAt,
      revokedAt: null,
    })
    return { accessToken: this.jwt.signAccess(input.userId, input.role, session.id), refreshToken }
  }
}
