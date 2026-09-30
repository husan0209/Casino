/**
 * Атрибуция игрока к партнёру (UC-AFF-06, ТЗ ч.8 §7.3, §13.2).
 *
 * Вызывается из auth-модуля при регистрации (email / Google / Telegram) ЧЕРЕЗ
 * AffiliateFacade — прямого импорта репозитория из auth запрещён правилом
 * «межмодульное общение только через Facade» (AI_DEVELOPMENT_RULES §4).
 *
 * Ключевое бизнес-правило: атрибуция создаётся ОДИН раз и навсегда. Повторные
 * попытки с другим кодом игнорируются — иначе конкурирующие партнёры
 * «перехватывали» бы игроков друг у друга.
 */
import { Inject, Injectable, Logger } from '@nestjs/common'

import { errorMessage } from '@/common/utils/error-message'

import { canAttributeTraffic } from '../../domain/entities/affiliate.entity'
import {
  AFFILIATE_ATTRIBUTION_REPOSITORY,
  AFFILIATE_CLICK_REPOSITORY,
  AFFILIATE_IP_FINGERPRINTER,
  AFFILIATE_REPOSITORY,
  type AffiliateAttributionRepository,
  type AffiliateClickRepository,
  type AffiliateRepository,
  type IpFingerprinter,
} from '../../domain/repositories/affiliate.repository'
import { AffiliateSettingsService } from '../affiliate-settings.service'

/** Окно для правила F3 (ip_flood): сутки. */
const IP_FLOOD_WINDOW_MS = 24 * 60 * 60 * 1000

export interface AttributePlayerInput {
  playerId: string
  /** Код партнёра по приоритету: query `?ref=` → localStorage → cookie. */
  trackingCode?: string | undefined
  ip?: string | undefined
  userAgent?: string | undefined
}

export interface AttributePlayerResult {
  attributed: boolean
  affiliateId: string | null
  /** Причина неатрибуции — для логов и метрик, не для ответа клиенту. */
  reason:
    | 'attributed'
    | 'no_code'
    | 'program_disabled'
    | 'unknown_code'
    | 'not_active'
    | 'already_attributed'
    | 'self_referral'
    | 'error'
}

@Injectable()
export class AttributePlayerUseCase {
  private readonly logger = new Logger(AttributePlayerUseCase.name)

  constructor(
    @Inject(AFFILIATE_REPOSITORY) private readonly affiliates: AffiliateRepository,
    @Inject(AFFILIATE_ATTRIBUTION_REPOSITORY)
    private readonly attributions: AffiliateAttributionRepository,
    @Inject(AFFILIATE_CLICK_REPOSITORY) private readonly clicks: AffiliateClickRepository,
    @Inject(AFFILIATE_IP_FINGERPRINTER) private readonly fingerprinter: IpFingerprinter,
    // Явный @Inject ОБЯЗАТЕЛЕН для class-токенов: в этой сборке
    // emitDecoratorMetadata не выдаёт design:paramtypes, поэтому инъекция «по
    // типу» молча передаёт undefined (проверено функциональным прогоном).
    @Inject(AffiliateSettingsService) private readonly settings: AffiliateSettingsService,
  ) {}

  async execute(input: AttributePlayerInput): Promise<AttributePlayerResult> {
    const settings = await this.settings.get()
    if (!settings.isEnabled) {
      return { attributed: false, affiliateId: null, reason: 'program_disabled' }
    }
    if (input.trackingCode === undefined || input.trackingCode.trim() === '') {
      return { attributed: false, affiliateId: null, reason: 'no_code' }
    }

    try {
      return await this.attribute(input, settings.autoSuspendThreshold)
    } catch (err) {
      // Ошибка атрибуции НЕ должна ломать регистрацию игрока: игрок зарегистрировался
      // в любом случае, просто без привязки к партнёру.
      this.logger.error(
        `Affiliate attribution failed for player=${input.playerId}: ${errorMessage(err)}`,
      )
      return { attributed: false, affiliateId: null, reason: 'error' }
    }
  }

  private async attribute(
    input: AttributePlayerInput,
    autoSuspendThreshold: number,
  ): Promise<AttributePlayerResult> {
    const trackingCode = input.trackingCode as string
    const affiliate = await this.affiliates.findByTrackingCode(trackingCode)
    if (affiliate === null) {
      return { attributed: false, affiliateId: null, reason: 'unknown_code' }
    }
    if (!canAttributeTraffic(affiliate)) {
      return { attributed: false, affiliateId: null, reason: 'not_active' }
    }

    // Правило приоритета атрибуции: игрок принадлежит одному партнёру навсегда.
    const existing = await this.attributions.findByPlayerId(input.playerId)
    if (existing !== null) {
      this.logger.warn(
        `Player ${input.playerId} already attributed to ${existing.affiliateId}, ignoring code=${affiliate.trackingCode}`,
      )
      return { attributed: false, affiliateId: null, reason: 'already_attributed' }
    }

    const lastClick = await this.clicks.findLastByAffiliate(affiliate.id)
    const verdict = await this.detectFraud(affiliate.id, lastClick, input, autoSuspendThreshold)

    await this.attributions.create({
      affiliateId: affiliate.id,
      playerId: input.playerId,
      clickId: lastClick?.clickId ?? null,
      status: verdict.isSelfReferral ? 'rejected' : 'pending',
      isSelfReferral: verdict.isSelfReferral,
      rejectReason: verdict.isSelfReferral ? verdict.reason : null,
    })

    const convertedClickId = lastClick?.clickId
    if (convertedClickId !== undefined && convertedClickId !== null) {
      await this.clicks.markConverted(convertedClickId)
    }

    if (verdict.isSelfReferral) {
      this.logger.warn(
        `Self-referral blocked: player=${input.playerId} affiliate=${affiliate.id} reason=${verdict.reason}`,
      )
      return { attributed: false, affiliateId: null, reason: 'self_referral' }
    }

    return { attributed: true, affiliateId: affiliate.id, reason: 'attributed' }
  }

  /**
   * Автоматические антифрод-правила F1–F3 (ТЗ ч.8 §13.2).
   *
   * F4 (депозит ровно на порог) сознательно НЕ блокирует: это эвристика с
   * высоким процентом ложных срабатываний, она только помечает атрибуцию
   * для ручной проверки и реализована в qualify-потоке.
   *
   * F1/F2 сравнивают партнёра и игрока по одному устройству. Ложные
   * срабатывания реальны (офис, CGNAT, мобильный оператор), поэтому отказ
   * обратим: админ может перевести атрибуцию в qualified вручную.
   *
   * Хеш IP обязан считаться ТОЙ ЖЕ реализацией, что и при записи клика, иначе
   * сравнения молча перестанут совпадать. Поэтому порт IpFingerprinter
   * инъецируется, а не дублируется здесь.
   */
  private async detectFraud(
    affiliateId: string,
    lastClick: { ipHash: string | null; userAgent: string | null } | null,
    input: AttributePlayerInput,
    autoSuspendThreshold: number,
  ): Promise<{ isSelfReferral: boolean; reason: 'self_referral' | 'ip_flood' | null }> {
    if (lastClick === null) {
      return { isSelfReferral: false, reason: null }
    }
    if (this.matchesPartnerDevice(lastClick, input)) {
      return { isSelfReferral: true, reason: 'self_referral' }
    }
    return this.checkIpFlood(affiliateId, input, autoSuspendThreshold)
  }

  /**
   * F1/F2 — партнёр и игрок с одного устройства.
   *
   * Вынесено отдельным методом, чтобы detectFraud оставался в бюджете
   * complexity, а правила читались как чек-лист из ТЗ §13.2, а не как каша
   * условий в одном теле.
   */
  private matchesPartnerDevice(
    lastClick: { ipHash: string | null; userAgent: string | null },
    input: AttributePlayerInput,
  ): boolean {
    // F1 — совпадение хеша IP последнего клика партнёра с IP регистрации игрока
    if (input.ip !== undefined && input.ip !== '') {
      if (lastClick.ipHash === this.fingerprinter.hash(input.ip)) {
        return true
      }
    }
    // F2 — точное совпадение User-Agent партнёра и игрока
    return (
      input.userAgent !== undefined &&
      input.userAgent !== '' &&
      lastClick.userAgent !== null &&
      lastClick.userAgent === input.userAgent
    )
  }

  /** F3 — флуд: один IP приводит слишком много квалифицированных игроков. */
  private async checkIpFlood(
    affiliateId: string,
    input: AttributePlayerInput,
    autoSuspendThreshold: number,
  ): Promise<{ isSelfReferral: boolean; reason: 'self_referral' | 'ip_flood' | null }> {
    if (input.ip === undefined || input.ip === '' || autoSuspendThreshold <= 0) {
      return { isSelfReferral: false, reason: null }
    }
    const fromSameIp = await this.clicks.countQualifiedByIpHash({
      affiliateId,
      ipHash: this.fingerprinter.hash(input.ip),
      since: new Date(Date.now() - IP_FLOOD_WINDOW_MS),
    })
    if (fromSameIp < autoSuspendThreshold) {
      return { isSelfReferral: false, reason: null }
    }
    this.logger.error(
      `Affiliate ${affiliateId} exceeded ip_flood threshold: ${fromSameIp} >= ${autoSuspendThreshold}`,
    )
    return { isSelfReferral: true, reason: 'ip_flood' }
  }
}
