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
 * AffiliatePlayerProvisioningRepository и IAffiliateJwtService
 * (AI_DEVELOPMENT_RULES §3.2, решение В5).
 */
import { Inject, Injectable } from '@nestjs/common'
import * as argon2 from 'argon2'

import { AFFILIATE_JWT_SERVICE, type IAffiliateJwtService } from '../../domain/affiliate.ports'
import { AffiliateAlreadyExistsError } from '../../domain/errors/affiliate.errors'
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
  constructor(
    @Inject(AFFILIATE_REPOSITORY) private readonly affiliates: AffiliateRepository,
    @Inject(AFFILIATE_PLAYER_PROVISIONING_REPOSITORY)
    private readonly players: AffiliatePlayerProvisioningRepository,
    @Inject(AffiliateSettingsService) private readonly settings: AffiliateSettingsService,
    @Inject(AFFILIATE_JWT_SERVICE) private readonly jwt: IAffiliateJwtService,
  ) {}

  async execute(input: RegisterAffiliateInput): Promise<RegisterAffiliateResult> {
    const email = input.email.toLowerCase().trim()
    const settings = await this.settings.get()

    const existing = await this.affiliates.findByEmail(email)
    if (existing !== null) {
      throw new AffiliateAlreadyExistsError(email)
    }

    // Ставка берётся из настроек программы — это и есть «процент, назначаемый
    // через админку». Индивидуальная ставка партнёра позже перекроет её.
    const revshareRate = parseRevShareRate(settings.defaultRevshareRate)
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id })
    const trackingCode = await this.affiliates.generateUniqueTrackingCode()
    const player = await this.players.createPlayerUser({
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
      // (например, при гонке на уникальном email).
      await this.players.deletePlayerUser(player.id).catch(() => undefined)
      throw err
    }
  }

  /** Ссылка партнёра: домен из APP_URL, как и у игровых реферальных ссылок. */
  private buildTrackingUrl(trackingCode: string): string {
    const appUrl = process.env['APP_URL'] ?? 'http://localhost:3000'
    return `${appUrl.replace(/\/+$/, '')}/go/${trackingCode}`
  }
}
