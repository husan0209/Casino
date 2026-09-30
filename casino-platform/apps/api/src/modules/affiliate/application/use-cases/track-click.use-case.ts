/**
 * Трекинг кликов по ссылкам партнёров (UC-AFF-05, ТЗ ч.8 §7.2).
 *
 * Публичный endpoint без авторизации — единственная точка входа трафика.
 * Отвечает ДО любых проверок, чтобы не ломать редирект для бота/пользователя.
 */
import { Inject, Injectable, Logger } from '@nestjs/common'

import { errorMessage } from '@/common/utils/error-message'

import { canAttributeTraffic } from '../../domain/entities/affiliate.entity'
import {
  AFFILIATE_CLICK_REPOSITORY,
  AFFILIATE_IP_FINGERPRINTER,
  AFFILIATE_REPOSITORY,
  type AffiliateClickRepository,
  type AffiliateRepository,
  type IpFingerprinter,
} from '../../domain/repositories/affiliate.repository'
import { extractRefererHost, sanitizeUserAgent } from '../../infrastructure/ip-hasher'
import { AffiliateSettingsService } from '../affiliate-settings.service'

/** Куда уходит трафик, если deep-link невалиден или партнёр неактивен. */
export const FALLBACK_PATH = '/casino'

/** Параметры трекинг-ссылки. */
export interface TrackClickInput {
  trackingCode: string
  /** Deep-link: путь лендинга. Валидируется whitelist'ом. */
  path?: string | undefined
  campaignId?: string | undefined
  subId?: string | undefined
  ip?: string | undefined
  userAgent?: string | undefined
  referer?: string | undefined
  geoCountry?: string | undefined
}

export interface TrackClickResult {
  /** Куда редиректить. Всегда абсолютный путь внутри нашего домена. */
  redirectPath: string
  /** Устанавливать ли cookie атрибуции. */
  shouldSetCookie: boolean
  /** Код для cookie (uppercase). null, если атрибуция невозможна. */
  cookieCode: string | null
  /** Срок жизни cookie в днях (из настроек). */
  cookieDays: number
}

/**
 * Whitelist deep-link путей.
 *
 * ЗАЩИТА ОТ OPEN REDIRECT — критична: параметр `p` приходит из интернета и
 * без валидации позволяет использовать наш домен как редирект-прокси на
 * фишинговые сайты. Разрешаем ТОЛЬКО внутренние пути каталога /casino.
 */
const ALLOWED_PATH_PATTERN = /^\/casino(?:\/[A-Za-z0-9._~-]+)*\/?$/
const MAX_PATH_LENGTH = 255

@Injectable()
export class TrackClickUseCase {
  private readonly logger = new Logger(TrackClickUseCase.name)

  // eslint-disable-next-line max-params -- Nest DI: состав конструктора задаётся графом зависимостей (GAP-25, как в WalletFacade)
  constructor(
    @Inject(AFFILIATE_REPOSITORY) private readonly affiliates: AffiliateRepository,
    @Inject(AFFILIATE_CLICK_REPOSITORY) private readonly clicks: AffiliateClickRepository,
    @Inject(AFFILIATE_IP_FINGERPRINTER) private readonly fingerprinter: IpFingerprinter,
    // Явный @Inject ОБЯЗАТЕЛЕН для class-токенов: в этой сборке
    // emitDecoratorMetadata не выдаёт design:paramtypes, поэтому инъекция «по
    // типу» молча передаёт undefined (проверено функциональным прогоном).
    @Inject(AffiliateSettingsService) private readonly settings: AffiliateSettingsService,
  ) {}

  async execute(input: TrackClickInput): Promise<TrackClickResult> {
    const settings = await this.settings.get()
    // Отказ без cookie: пользователь всё равно уходит на витрину, но код
    // партнёра не ставится — иначе неактивный партнёр всё равно получил бы трафик.
    const safeResult = (): TrackClickResult => ({
      redirectPath: FALLBACK_PATH,
      shouldSetCookie: false,
      cookieCode: null,
      cookieDays: settings.cookieDays,
    })

    if (!settings.isEnabled) {
      this.logger.warn(`Affiliate tracking disabled, rejecting code=${input.trackingCode}`)
      return safeResult()
    }

    const affiliate = await this.affiliates.findByTrackingCode(input.trackingCode)
    if (affiliate === null) {
      this.logger.warn(`Unknown affiliate tracking code: ${input.trackingCode}`)
      return safeResult()
    }
    if (!canAttributeTraffic(affiliate)) {
      this.logger.warn(`Affiliate ${affiliate.id} is ${affiliate.status}, rejecting click`)
      return safeResult()
    }

    const landingPath = sanitizePath(input.path)
    await this.recordClick(affiliate.id, input, landingPath)
    await this.affiliates.touchLastClick(affiliate.id, new Date())

    return {
      redirectPath: landingPath,
      shouldSetCookie: true,
      cookieCode: affiliate.trackingCode,
      cookieDays: settings.cookieDays,
    }
  }

  /**
   * Запись клика — best effort.
   *
   * Fail-open осознанно: аналитика клика не должна ломать переход пользователя.
   * Ошибка логируется, но НЕ пробрасывается — иначе невалидная запись в БД
   * (например, переполнение колонки) сделала бы партнёрскую ссылку нерабочей.
   */
  private async recordClick(
    affiliateId: string,
    input: TrackClickInput,
    landingPath: string,
  ): Promise<void> {
    try {
      await this.clicks.create({
        affiliateId,
        landingPath,
        ipHash: this.fingerprinter.hash(input.ip ?? ''),
        userAgent: sanitizeUserAgent(input.userAgent),
        refererHost: extractRefererHost(input.referer),
        geoCountry: input.geoCountry ?? null,
        campaignId: input.campaignId ?? null,
        subId: input.subId ?? null,
      })
    } catch (err) {
      this.logger.error(`Failed to record affiliate click: ${errorMessage(err)}`)
    }
  }
}

/**
 * Валидирует deep-link: только внутренние пути /casino, без схем, без
 * протокол-относительных URL (`//evil.com`), без управляющих символов.
 */
export function sanitizePath(rawPath: string | undefined): string {
  if (rawPath === undefined || rawPath.trim() === '') {
    return FALLBACK_PATH
  }
  const candidate = rawPath.trim()
  if (candidate.length > MAX_PATH_LENGTH) {
    return FALLBACK_PATH
  }
  if (!candidate.startsWith('/')) {
    return FALLBACK_PATH
  }
  // `//host` и `/\host` — протокол-относительные URL, ведущие на другой хост
  if (candidate.startsWith('//') || candidate.startsWith('/\\')) {
    return FALLBACK_PATH
  }
  if (!ALLOWED_PATH_PATTERN.test(candidate)) {
    return FALLBACK_PATH
  }
  return candidate
}
