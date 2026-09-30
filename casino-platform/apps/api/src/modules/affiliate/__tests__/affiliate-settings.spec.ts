import { beforeEach, describe, expect, it } from 'vitest'

import { AffiliateSettingsService } from '../application/affiliate-settings.service'
import {
  AFFILIATE_SETTING_KEYS,
  AFFILIATE_SETTINGS_DEFAULTS,
  type AffiliateSettingType,
  type RawSetting,
  buildSettings,
  parseBooleanSetting,
  validateSettingValue,
} from '../domain/affiliate-settings'
import { parseRevShareRate } from '../domain/value-objects/revshare-rate.value-object'

function rawRow(key: string, value: string, type: AffiliateSettingType = 'string'): RawSetting {
  return {
    key,
    value,
    type,
    category: 'affiliate',
    description: null,
    updatedAt: new Date(),
    updatedBy: 'admin-1',
  }
}

describe('buildSettings', () => {
  it('falls back to documented defaults when nothing is stored', () => {
    expect(buildSettings([])).toEqual(AFFILIATE_SETTINGS_DEFAULTS)
  })

  it('keeps the revshare rate as a decimal string, never a float', () => {
    const settings = buildSettings([
      rawRow(AFFILIATE_SETTING_KEYS.defaultRevshareRate, '0.25', 'number'),
    ])

    expect(settings.defaultRevshareRate).toBe('0.2500')
    expect(typeof settings.defaultRevshareRate).toBe('string')
  })

  it('parses boolean flags in both textual and numeric form', () => {
    const settings = buildSettings([
      rawRow(AFFILIATE_SETTING_KEYS.enabled, 'true', 'boolean'),
      rawRow(AFFILIATE_SETTING_KEYS.requireKyc, 'false', 'boolean'),
    ])

    expect(settings.isEnabled).toBe(true)
    expect(settings.requireKyc).toBe(false)
  })

  it('keeps defaults for unparseable booleans instead of crashing', () => {
    expect(parseBooleanSetting('garbage', true)).toBe(true)
    expect(parseBooleanSetting('0', true)).toBe(false)
  })

  it('reads the cookie window from the database', () => {
    const settings = buildSettings([rawRow(AFFILIATE_SETTING_KEYS.cookieDays, '60', 'number')])
    expect(settings.cookieDays).toBe(60)
  })
})

describe('validateSettingValue', () => {
  it('accepts a rate inside [0, 1]', () => {
    expect(() =>
      validateSettingValue(AFFILIATE_SETTING_KEYS.defaultRevshareRate, '0.35', 'number'),
    ).not.toThrow()
  })

  it('rejects a rate above 100%', () => {
    expect(() =>
      validateSettingValue(AFFILIATE_SETTING_KEYS.defaultRevshareRate, '1.5', 'number'),
    ).toThrow(/\[0, 1\]/)
  })

  it('rejects a non-boolean for a boolean key', () => {
    expect(() => validateSettingValue(AFFILIATE_SETTING_KEYS.enabled, 'yes', 'boolean')).toThrow(
      /expected boolean/,
    )
  })

  it('rejects a type that does not match the key', () => {
    expect(() => validateSettingValue(AFFILIATE_SETTING_KEYS.enabled, 'true', 'number')).toThrow(
      /expected type "boolean"/,
    )
  })

  it('rejects an out-of-range cookie window', () => {
    expect(() => validateSettingValue(AFFILIATE_SETTING_KEYS.cookieDays, '400', 'number')).toThrow(
      /expected integer in \[1, 365\]/,
    )
  })

  it('rejects a retention below 7 days', () => {
    expect(() =>
      validateSettingValue(AFFILIATE_SETTING_KEYS.clickRetentionDays, '1', 'number'),
    ).toThrow()
  })

  it('rejects an unsupported attribution model', () => {
    expect(() =>
      validateSettingValue(AFFILIATE_SETTING_KEYS.attributionModel, 'first_click', 'string'),
    ).toThrow(/only last_click supported/)
  })

  it('rejects a malformed terms version', () => {
    expect(() => validateSettingValue(AFFILIATE_SETTING_KEYS.termsVersion, 'v1', 'string')).toThrow(
      /semver/,
    )
  })

  it('rejects a negative deposit threshold', () => {
    expect(() => validateSettingValue(AFFILIATE_SETTING_KEYS.minDeposit, '-1', 'number')).toThrow(
      /expected number >= 0/,
    )
  })
})

describe('AffiliateSettingsService', () => {
  let stored: RawSetting[]
  let written: Array<{ key: string; value: string }>
  let service: AffiliateSettingsService

  beforeEach(() => {
    stored = []
    written = []
    service = new AffiliateSettingsService({
      listRaw: (): Promise<RawSetting[]> => Promise.resolve(stored),
      set: (args: { key: string; value: string }): Promise<void> => {
        written.push({ key: args.key, value: args.value })
        return Promise.resolve()
      },
    })
  })

  it('serves defaults when no settings exist yet', async () => {
    const settings = await service.get()
    expect(settings).toEqual(AFFILIATE_SETTINGS_DEFAULTS)
  })

  it('caches reads so a hot path does not hit the database on every call', async () => {
    let reads = 0
    const cached = new AffiliateSettingsService({
      listRaw: (): Promise<RawSetting[]> => {
        reads += 1
        return Promise.resolve([])
      },
      set: (): Promise<void> => Promise.resolve(),
    })

    await cached.get()
    await cached.get()
    await cached.get()

    expect(reads).toBe(1)
  })

  it('invalidates the cache after an admin writes a setting', async () => {
    await service.get()
    await service.set({
      key: AFFILIATE_SETTING_KEYS.cookieDays,
      value: '45',
      type: 'number',
      updatedBy: 'admin-1',
    })

    expect(written).toEqual([{ key: AFFILIATE_SETTING_KEYS.cookieDays, value: '45' }])

    stored = [rawRow(AFFILIATE_SETTING_KEYS.cookieDays, '45', 'number')]
    const settings = await service.get()
    expect(settings.cookieDays).toBe(45)
  })

  it('rejects an invalid value before it reaches the database', async () => {
    await expect(
      service.set({
        key: AFFILIATE_SETTING_KEYS.defaultRevshareRate,
        value: '5',
        type: 'number',
        updatedBy: 'admin-1',
      }),
    ).rejects.toThrow(/\[0, 1\]/)

    expect(written).toHaveLength(0)
  })

  it('exposes the rate as a value object for downstream use', async () => {
    stored = [rawRow(AFFILIATE_SETTING_KEYS.defaultRevshareRate, '0.3', 'number')]
    const settings = await service.get()

    expect(parseRevShareRate(settings.defaultRevshareRate)).toBe('0.3000')
  })
})
