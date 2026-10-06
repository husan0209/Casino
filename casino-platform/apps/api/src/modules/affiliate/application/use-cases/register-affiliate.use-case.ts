/**
 * Регистрация партнёра (UC-AFF-01, ТЗ ч.8 §9).
 *
 * Партнёр — внешний контрагент, а не игрок. Ему создаётся СВОЯ user-запись
 * (status=active, email пустой), потому что начисления идут на его кошелёк
 * через WalletFacade, а вывод — через общую кассу игрока (решение D3).
 *
 * Почему email пустой: affiliates.email — рабочий адрес партнёра. users.email
 * уникален, и совпадение с адресом игрока (партнёр может играть сам) сломало бы
 * регистрацию. Поэтому адрес хранится только в affiliate.
 *
 * БД и JWT не импортируются: работа идёт через порты domain —
 * AffiliatePlayerProvisioningRepository (только ЧТЕНИЯ, ADR GAP-51) и
 * IAffiliateJwtService (AI_DEVELOPMENT_RULES §3.2, решение В5). Запись в
 * `users` — через `UsersFacade` (GAP-62 закрыт: межмодульное общение только
 * через фасад, MODULE_BOUNDARIES).
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import * as argon2 from 'argon2'

import { errorMessage } from '@/common/utils/error-message'

import { UsersFacade } from '@modules/users/facade/users.facade'

import { AFFILIATE_JWT_SERVICE, type IAffiliateJwtService } from '../../domain/affiliate.ports'
import {
  AffiliateAlreadyExistsError,
  AffiliateProgramDisabledError,
} from '../../domain/errors/affiliate.errors'
import {
  AFFILIATE_PLAYER_PROVISIONING_REPOSITORY,
  AFFILIATE_REPOSITORY,
  type AffiliatePlayerProvisioningRepository,
  type AffiliateRepository,
} from '../../domain/repositories/affiliate.repository'
import { parseRevShareRate } from '../../domain/value-objects/revshare-rate.value-object'
import { generateUniquePlayerReferralCode } from '../affiliate-player-referral-code'
import { AffiliateSettingsService } from '../affiliate-settings.service'

export interface RegisterAffiliateInput {
  email: string
  password: string
  displayName?: string | undefined
  telegram?: string | undefined
  website?: string | undefined
  /** Принял ли соглашение. Без acceptTerms регистрация невозможна. */
  acceptTerms: boolean
}

export interface RegisterAffiliateResult {
  affiliateId: string
  trackingCode: string
  trackingUrl: string
  revshareRate: string
  accessToken: string
  message: string
}

@Injectable()
export class RegisterAffiliateUseCase {
  private readonly logger = new Logger(RegisterAffiliateUseCase.name)

  constructor(
    @Inject(AFFILIATE_REPOSITORY) private readonly affiliates: AffiliateRepository,
    // Чтение чужих таблиц (свободен ли referral_code) — порт; ADR GAP-51.
    @Inject(AFFILIATE_PLAYER_PROVISIONING_REPOSITORY)
    private readonly players: AffiliatePlayerProvisioningRepository,
    @Inject(AffiliateSettingsService) private readonly settings: AffiliateSettingsService,
    @Inject(AFFILIATE_JWT_SERVICE) private readonly jwt: IAffiliateJwtService,
    // GAP-62: запись в `users` только через фасад владельца данных.
    @Inject(UsersFacade) private readonly users: UsersFacade,
  ) {}

  async execute(input: RegisterAffiliateInput): Promise<RegisterAffiliateResult> {
    const email = input.email.toLowerCase().trim()
    const settings = await this.settings.get()

    // Kill-switch программы. Click и атрибуция его уже слушают
    // (track-click.use-case.ts:84, attribute-player.use-case.ts:73), поэтому без
    // этой проверки регистрация принимала бы партнёров в выключенную программу:
    // код партнёра выдавался бы, а конверсии по нему не возникало бы никогда.
    // До проверки — без сайд-эффектов: provisioning-запись в users не должна
    // появиться у отказа.
    if (!settings.isEnabled) {
      throw new AffiliateProgramDisabledError()
    }

    const existing = await this.affiliates.findByEmail(email)
    if (existing !== null) {
      throw new AffiliateAlreadyExistsError(email)
    }

    // Ставка берётся из настроек программы — это и есть «процент, назначаемый
    // через админку». Индивидуальная ставка партнёра позже перекроет её.
    const revshareRate = parseRevShareRate(settings.defaultRevshareRate)
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id })
    const trackingCode = await this.affiliates.generateUniqueTrackingCode()
    const player = await this.users.provisionAffiliatePlayer({
      referralCode: await generateUniquePlayerReferralCode(this.players),
    })
    try {
      const affiliate = await this.affiliates.create({
        userId: player.id,
        email,
        passwordHash,
        trackingCode,
        revshareRate,
        payoutCurrency: 'RUB',
        displayName: input.displayName ?? null,
        telegram: input.telegram ?? null,
        website: input.website ?? null,
        isAgreed: input.acceptTerms,
      })
      return {
        affiliateId: affiliate.id,
        trackingCode: affiliate.trackingCode,
        trackingUrl: this.buildTrackingUrl(affiliate.trackingCode),
        revshareRate: affiliate.revshareRate,
        accessToken: this.jwt.signAccess(affiliate.id, affiliate.email),
        message: 'Партнёр зарегистрирован',
      }
    } catch (err) {
      // Компенсирующая проводка: без неё user-запись осталась бы сиротой
      // (например, при гонке на уникальном email). try покрывает и выдачу
      // токена: отказ JWT после успешной записи тоже должен откатывать пару
      // строк, иначе партнёр останется без токена и не сможет войти.
      await this.deprovisionPlayer(player.id, err)
      throw err
    }
  }

  /**
   * Компенсация: снятие служебной user-записи, ставшей сиротой.
   *
   * Ошибку удаления не поднимаем — иначе клиент вместо настоящей причины
   * отказа (`affiliates.create`) получил бы вторую ошибку поверх неё. Но и
   * молча проглотить её нельзя: сирота в `users` при этом остаётся, и без
   * записи в лог о нём никто не узнает (GAP-62).
   */
  private async deprovisionPlayer(userId: string, cause: unknown): Promise<void> {
    try {
      await this.users.deprovisionAffiliatePlayer(userId)
    } catch (cleanupError: unknown) {
      this.logger.warn(
        `Orphan player ${userId} left in users after affiliate register failed ` +
          `(${errorMessage(cause)}); compensating delete failed: ${errorMessage(cleanupError)}`,
      )
    }
  }

  /** Ссылка партнёра: домен из APP_URL, как и у игровых реферальных ссылок. */
  private buildTrackingUrl(trackingCode: string): string {
    const appUrl = process.env['APP_URL'] ?? 'http://localhost:3000'
    return `${appUrl.replace(/\/+$/, '')}/go/${trackingCode}`
  }
}
