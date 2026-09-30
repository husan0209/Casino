/**
 * Сервис настроек партнёрской программы (ТЗ ч.8 §6.5, §17).
 *
 * Кэш в памяти на AFFILIATE_SETTINGS_TTL_MS + инвалидация при записи из админки.
 *
 * Зачем кэш: настройки читаются на каждом клике, каждой регистрации и в каждом
 * цикле расчёта — то есть на горячих путях. Поход в БД на каждый клик — лишняя
 * нагрузка без выгоды: настройки меняются раз в месяц админом.
 *
 * Зачем инвалидация, а не «ждать TTL»: админ меняет ставку и сразу ожидает
 * эффект. Ждать до минуты — плохой UX и риск начислений по старой ставке.
 */
import { Inject, Injectable } from '@nestjs/common'

import {
  AFFILIATE_SETTINGS_DEFAULTS,
  AFFILIATE_SETTINGS_REPOSITORY,
  type AffiliateSettingKey,
  type AffiliateSettings,
  type AffiliateSettingsRepository,
  type AffiliateSettingType,
  type RawSetting,
  validateSettingValue,
  buildSettings,
} from '../domain/affiliate-settings'

/** TTL кэша настроек: 60 секунд — баланс между нагрузкой на БД и «свежестью». */
export const AFFILIATE_SETTINGS_TTL_MS = 60_000

@Injectable()
export class AffiliateSettingsService {
  private cache: AffiliateSettings | null = null
  private cacheExpiresAt = 0

  constructor(
    @Inject(AFFILIATE_SETTINGS_REPOSITORY)
    private readonly repository: AffiliateSettingsRepository,
  ) {}

  /**
   * Типизированный снимок настроек. При отсутствии записей в БД — дефолты,
   * поэтому программа работоспособна сразу после миграции, без ручного сида.
   */
  async get(): Promise<AffiliateSettings> {
    if (this.cache !== null && Date.now() < this.cacheExpiresAt) {
      return this.cache
    }
    const raw = await this.repository.listRaw()
    const settings = raw.length > 0 ? buildSettings(raw) : { ...AFFILIATE_SETTINGS_DEFAULTS }
    this.cache = settings
    this.cacheExpiresAt = Date.now() + AFFILIATE_SETTINGS_TTL_MS
    return settings
  }

  /** Сырые записи для админ-UI (показывает фактические значения из БД). */
  async listRaw(): Promise<RawSetting[]> {
    return this.repository.listRaw()
  }

  /**
   * Запись настройки из админки. Валидирует значение ДО записи, чтобы в БД
   * не попало мусорное значение, из-за которого расчёт молча упал бы в дефолт.
   */
  async set(args: {
    key: AffiliateSettingKey
    value: string
    type: AffiliateSettingType
    updatedBy: string
  }): Promise<void> {
    validateSettingValue(args.key, args.value, args.type)
    await this.repository.set(args)
    this.invalidate()
  }

  /** Сброс кэша. Вызывается при записи и в тестах. */
  invalidate(): void {
    this.cache = null
    this.cacheExpiresAt = 0
  }
}
