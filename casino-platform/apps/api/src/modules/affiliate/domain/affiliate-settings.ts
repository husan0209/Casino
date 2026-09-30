/**
 * Настройки партнёрской программы (ТЗ ч.8 §6.5).
 *
 * Хранятся в существующей таблице system_settings с префиксом `affiliate_`.
 * Отдельная таблица не заводится: настройки — те же key/value, что и остальная
 * конфигурация, и их уже умеет редактировать AdminSettingsController с
 * аудит-логом.
 *
 * Чтение кэшируется в памяти на AFFILIATE_SETTINGS_TTL_MS, запись из админки
 * инвалидирует кэш. Приоритет: запись в БД > env (ТЗ ч.8 §17) — иначе админ
 * поменял ставку в UI, а cron считает по старому env.
 */
import { AffiliateSettingsInvalidError } from './errors/affiliate.errors'
import { parseRevShareRate } from './value-objects/revshare-rate.value-object'

/** Тип значения настройки (совпадает с enum SystemSettingType). */
export type AffiliateSettingType = 'string' | 'number' | 'boolean' | 'json'

/** Канонические ключи настроек. Строка-ключ — единственный источник правды. */
export const AFFILIATE_SETTING_KEYS = {
  enabled: 'affiliate_enabled',
  defaultRevshareRate: 'affiliate_default_revshare_rate',
  cookieDays: 'affiliate_cookie_days',
  minDeposit: 'affiliate_min_deposit',
  requireKyc: 'affiliate_require_kyc',
  negativeCarryover: 'affiliate_negative_carryover',
  attributionModel: 'affiliate_attribution_model',
  clickRetentionDays: 'affiliate_click_retention_days',
  autoSuspendThreshold: 'affiliate_auto_suspend_threshold',
  termsVersion: 'affiliate_terms_version',
} as const

export type AffiliateSettingKey =
  (typeof AFFILIATE_SETTING_KEYS)[keyof typeof AFFILIATE_SETTING_KEYS]

/** Типизированный снимок настроек, как их видит use case. */
export interface AffiliateSettings {
  /** Общий флаг программы. false → клики не атрибутируются, регистрация закрыта. */
  isEnabled: boolean
  /** Ставка для новых партнёров. Перекрывается индивидуальной ставкой. */
  defaultRevshareRate: string
  /** Cookie-окно атрибуции в днях (рыночная норма 30–90). */
  cookieDays: number
  /** Порог допуска в RUB: депозит меньше — атрибуция остаётся pending. 0 = без порога. */
  minDepositRub: number
  /** Требовать KYC approved для квалификации. */
  requireKyc: boolean
  /** Перенос отрицательного остатка NGR на следующий период. MVP: false. */
  negativeCarryover: boolean
  /** Модель атрибуции. В MVP поддерживается только last_click. */
  attributionModel: string
  /** Retention кликов в днях (cleanup job). */
  clickRetentionDays: number
  /** Фрод-скор для авто-подвеса партнёра (число игроков с одного IP за 24ч). */
  autoSuspendThreshold: number
  /** Версия соглашения партнёра. */
  termsVersion: string
}

/** Дефолты — совпадают со значениями сида в БД и с env (ТЗ ч.8 §6.5, §17). */
export const AFFILIATE_SETTINGS_DEFAULTS: AffiliateSettings = {
  isEnabled: true,
  defaultRevshareRate: '0.2000',
  cookieDays: 30,
  minDepositRub: 0,
  requireKyc: true,
  negativeCarryover: false,
  attributionModel: 'last_click',
  clickRetentionDays: 180,
  autoSuspendThreshold: 20,
  termsVersion: '1.0',
}

/** Сырая запись system_settings для ключа программы. */
export interface RawSetting {
  key: string
  value: string
  type: AffiliateSettingType
  category: string | null
  description: string | null
  updatedAt: Date
  updatedBy: string | null
}

export interface AffiliateSettingsRepository {
  /** Сырые записи всех настроек программы (для админ-UI). */
  listRaw(): Promise<RawSetting[]>
  /** Записать значение настройки. Валидация — на вызывающей стороне (UC-AFF-21). */
  set(args: {
    key: AffiliateSettingKey
    value: string
    type: AffiliateSettingType
    updatedBy: string
  }): Promise<void>
}

/** DI-токен порта настроек (по образцу REFERRAL_REPOSITORY). */
export const AFFILIATE_SETTINGS_REPOSITORY = Symbol('AFFILIATE_SETTINGS_REPOSITORY')

// ─────────────────────────────────────────────────────────────────────────────
// Валидация и парсинг значений
// ─────────────────────────────────────────────────────────────────────────────

/** Приводит строку из БД к boolean. Неизвестное значение → дефолт. */
export function parseBooleanSetting(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) {
    return fallback
  }
  const normalized = raw.trim().toLowerCase()
  if (normalized === 'true' || normalized === '1') {
    return true
  }
  if (normalized === 'false' || normalized === '0') {
    return false
  }
  return fallback
}

/**
 * Приводит строку из БД к числу.
 *
 * @throws {AffiliateSettingsInvalidError} если значение задано, но не является числом.
 *   Молча проглатывать мусор нельзя: админ должен увидеть ошибку, а не «сброс в дефолт».
 */
export function parseNumberSetting(raw: string | undefined, fallback: number, key: string): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback
  }
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) {
    throw new AffiliateSettingsInvalidError(key, `not a number: ${raw}`)
  }
  return parsed
}

/**
 * Валидирует настройку перед записью из админки.
 *
 * Диапазоны — осознанно строгие: ставка [0,1], окно cookie 1..365 дней,
 * retention 7..3650, порог >= 0, фрод-порог 1..10000.
 */
export function validateSettingValue(
  key: AffiliateSettingKey,
  rawValue: string,
  type: AffiliateSettingType,
): void {
  assertSettingTypeMatchesKey(key, type)
  const validator = SETTING_VALIDATORS[key]
  validator(rawValue, key)
}

/** Диапазоны, при которых настройка имеет смысл (ТЗ ч.8 §6.5, §10.3). */
const RATE_MIN = 0
const RATE_MAX = 1
const COOKIE_DAYS_MIN = 1
const COOKIE_DAYS_MAX = 365
const RETENTION_DAYS_MIN = 7
const RETENTION_DAYS_MAX = 3650
const SUSPEND_THRESHOLD_MIN = 1
const SUSPEND_THRESHOLD_MAX = 10000
const SEMVER_PATTERN = /^\d+\.\d+$/
const SUPPORTED_ATTRIBUTION_MODELS = ['last_click']

type SettingValidator = (rawValue: string, key: AffiliateSettingKey) => void

/** Валидатор boolean-ключа. */
function assertBoolean(rawValue: string, key: AffiliateSettingKey): void {
  const normalized = rawValue.trim().toLowerCase()
  if (normalized !== 'true' && normalized !== 'false') {
    throw new AffiliateSettingsInvalidError(key, `expected boolean, got: ${rawValue}`)
  }
}

/** Границы целочисленной настройки. */
interface IntegerRange {
  min: number
  max: number
}

/** Валидатор целого числа в диапазоне. */
function assertIntegerInRange(
  rawValue: string,
  key: AffiliateSettingKey,
  range: IntegerRange,
): void {
  const parsed = Number(rawValue)
  if (!Number.isInteger(parsed) || parsed < range.min || parsed > range.max) {
    throw new AffiliateSettingsInvalidError(
      key,
      `expected integer in [${range.min}, ${range.max}], got: ${rawValue}`,
    )
  }
}

/** Валидатор числа >= 0. */
function assertNonNegative(rawValue: string, key: AffiliateSettingKey): void {
  const parsed = Number(rawValue)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new AffiliateSettingsInvalidError(key, `expected number >= 0, got: ${rawValue}`)
  }
}

/** Валидатор ставки RevShare: [0, 1]. */
function assertRateInRange(rawValue: string, key: AffiliateSettingKey): void {
  const rate = Number(rawValue)
  if (!Number.isFinite(rate) || rate < RATE_MIN || rate > RATE_MAX) {
    throw new AffiliateSettingsInvalidError(
      key,
      `expected number in [${RATE_MIN}, ${RATE_MAX}], got: ${rawValue}`,
    )
  }
}

function assertSupportedModel(rawValue: string, key: AffiliateSettingKey): void {
  if (!SUPPORTED_ATTRIBUTION_MODELS.includes(rawValue)) {
    throw new AffiliateSettingsInvalidError(
      key,
      `only ${SUPPORTED_ATTRIBUTION_MODELS.join(', ')} supported in MVP, got: ${rawValue}`,
    )
  }
}

function assertSemver(rawValue: string, key: AffiliateSettingKey): void {
  if (!SEMVER_PATTERN.test(rawValue.trim())) {
    throw new AffiliateSettingsInvalidError(key, `expected semver like "1.0", got: ${rawValue}`)
  }
}

/** Валидатор по ключу — вместо раздутого switch, чтобы удержать complexity ≤ 10. */
const SETTING_VALIDATORS: Record<AffiliateSettingKey, SettingValidator> = {
  [AFFILIATE_SETTING_KEYS.enabled]: assertBoolean,
  [AFFILIATE_SETTING_KEYS.requireKyc]: assertBoolean,
  [AFFILIATE_SETTING_KEYS.negativeCarryover]: assertBoolean,
  [AFFILIATE_SETTING_KEYS.minDeposit]: assertNonNegative,
  [AFFILIATE_SETTING_KEYS.defaultRevshareRate]: assertRateInRange,
  [AFFILIATE_SETTING_KEYS.attributionModel]: assertSupportedModel,
  [AFFILIATE_SETTING_KEYS.termsVersion]: assertSemver,
  [AFFILIATE_SETTING_KEYS.cookieDays]: (rawValue, key) =>
    assertIntegerInRange(rawValue, key, {
      min: COOKIE_DAYS_MIN,
      max: COOKIE_DAYS_MAX,
    }),
  [AFFILIATE_SETTING_KEYS.clickRetentionDays]: (rawValue, key) =>
    assertIntegerInRange(rawValue, key, {
      min: RETENTION_DAYS_MIN,
      max: RETENTION_DAYS_MAX,
    }),
  [AFFILIATE_SETTING_KEYS.autoSuspendThreshold]: (rawValue, key) =>
    assertIntegerInRange(rawValue, key, {
      min: SUSPEND_THRESHOLD_MIN,
      max: SUSPEND_THRESHOLD_MAX,
    }),
}

/**
 * Канонический тип хранения для каждого ключа.
 *
 * Нужен, чтобы админ не записал boolean-ключ как 'number': без проверки значение
 * 'true' в колонке с type=number сделало бы парсер молча упасть в дефолт, и
 * админ не понял бы почему его настройка «не работает».
 */
const SETTING_TYPE_BY_KEY: Record<AffiliateSettingKey, AffiliateSettingType> = {
  [AFFILIATE_SETTING_KEYS.enabled]: 'boolean',
  [AFFILIATE_SETTING_KEYS.defaultRevshareRate]: 'number',
  [AFFILIATE_SETTING_KEYS.cookieDays]: 'number',
  [AFFILIATE_SETTING_KEYS.minDeposit]: 'number',
  [AFFILIATE_SETTING_KEYS.requireKyc]: 'boolean',
  [AFFILIATE_SETTING_KEYS.negativeCarryover]: 'boolean',
  [AFFILIATE_SETTING_KEYS.attributionModel]: 'string',
  [AFFILIATE_SETTING_KEYS.clickRetentionDays]: 'number',
  [AFFILIATE_SETTING_KEYS.autoSuspendThreshold]: 'number',
  [AFFILIATE_SETTING_KEYS.termsVersion]: 'string',
}

function assertSettingTypeMatchesKey(key: AffiliateSettingKey, type: AffiliateSettingType): void {
  const expected = SETTING_TYPE_BY_KEY[key]
  if (type !== expected) {
    throw new AffiliateSettingsInvalidError(key, `expected type "${expected}", got "${type}"`)
  }
}

/** Собирает типизированный снимок настроек из сырых строк БД + дефолтов. */
export function buildSettings(raw: RawSetting[]): AffiliateSettings {
  const byKey = new Map(raw.map((row) => [row.key, row.value]))
  const read = (key: AffiliateSettingKey): string | undefined => byKey.get(key)

  const rawRate = read(AFFILIATE_SETTING_KEYS.defaultRevshareRate)
  // Ставка — денежно-чувствительный параметр: остаётся СТРОКОЙ. Number здесь
  // допустим только как промежуточное значение для нормализации до 4 знаков,
  // в AffiliateSettings наружу уходит строка.
  const defaultRevshareRate =
    rawRate !== undefined
      ? parseRevShareRate(
          parseNumberSetting(rawRate, 0.2, AFFILIATE_SETTING_KEYS.defaultRevshareRate),
        )
      : AFFILIATE_SETTINGS_DEFAULTS.defaultRevshareRate

  return {
    isEnabled: parseBooleanSetting(
      read(AFFILIATE_SETTING_KEYS.enabled),
      AFFILIATE_SETTINGS_DEFAULTS.isEnabled,
    ),
    defaultRevshareRate,
    cookieDays: parseNumberSetting(
      read(AFFILIATE_SETTING_KEYS.cookieDays),
      AFFILIATE_SETTINGS_DEFAULTS.cookieDays,
      AFFILIATE_SETTING_KEYS.cookieDays,
    ),
    minDepositRub: parseNumberSetting(
      read(AFFILIATE_SETTING_KEYS.minDeposit),
      AFFILIATE_SETTINGS_DEFAULTS.minDepositRub,
      AFFILIATE_SETTING_KEYS.minDeposit,
    ),
    requireKyc: parseBooleanSetting(
      read(AFFILIATE_SETTING_KEYS.requireKyc),
      AFFILIATE_SETTINGS_DEFAULTS.requireKyc,
    ),
    negativeCarryover: parseBooleanSetting(
      read(AFFILIATE_SETTING_KEYS.negativeCarryover),
      AFFILIATE_SETTINGS_DEFAULTS.negativeCarryover,
    ),
    attributionModel:
      read(AFFILIATE_SETTING_KEYS.attributionModel) ?? AFFILIATE_SETTINGS_DEFAULTS.attributionModel,
    clickRetentionDays: parseNumberSetting(
      read(AFFILIATE_SETTING_KEYS.clickRetentionDays),
      AFFILIATE_SETTINGS_DEFAULTS.clickRetentionDays,
      AFFILIATE_SETTING_KEYS.clickRetentionDays,
    ),
    autoSuspendThreshold: parseNumberSetting(
      read(AFFILIATE_SETTING_KEYS.autoSuspendThreshold),
      AFFILIATE_SETTINGS_DEFAULTS.autoSuspendThreshold,
      AFFILIATE_SETTING_KEYS.autoSuspendThreshold,
    ),
    termsVersion:
      read(AFFILIATE_SETTING_KEYS.termsVersion) ?? AFFILIATE_SETTINGS_DEFAULTS.termsVersion,
  }
}
