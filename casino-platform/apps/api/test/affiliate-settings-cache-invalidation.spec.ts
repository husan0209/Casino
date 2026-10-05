/**
 * Юнит-тесты AffiliateSettingsService — кэша настроек партнёрки (слепая зона G21).
 *
 * G21 гейтит только `*.use-case.ts`; этот сервис живёт в `application/` и тестов
 * не имел. Он стоит на путях начислений (ставка revShare читается в цикле
 * расчёта) и атрибуции кликов, поэтому две его ветки критичны:
 *  - валидация ОБЯЗАНА предшествовать записи: просочившееся в БД мусорное
 *    значение молча откатило бы расчёт к дефолту (об этом пишет сам сервис);
 *  - инвалидация кэса обязана идти ПОСЛЕ успешной записи, иначе кэш протухнет
 *    на неуспешную попытку и админ увидит «мои изменения пропали».
 * Отдельно зафиксировано, что снимок настроек — копия, а не сам синглтон
 * AFFILIATE_SETTINGS_DEFAULTS: иначе мутация кэша отравила бы дефолты всего
 * процесса.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AFFILIATE_SETTINGS_TTL_MS,
  AffiliateSettingsService,
} from '../src/modules/affiliate/application/affiliate-settings.service'
import {
  AFFILIATE_SETTING_KEYS,
  AFFILIATE_SETTINGS_DEFAULTS,
  type AffiliateSettings,
  type AffiliateSettingsRepository,
  type RawSetting,
} from '../src/modules/affiliate/domain/affiliate-settings'
import { AffiliateSettingsInvalidError } from '../src/modules/affiliate/domain/errors/affiliate.errors'

const FIXED_NOW = new Date('2026-06-01T12:00:00.000Z')

function rawSetting(key: string, value: string, type: RawSetting['type']): RawSetting {
  return {
    key,
    value,
    type,
    category: 'affiliate',
    description: null,
    updatedAt: FIXED_NOW,
    updatedBy: 'admin-1',
  }
}

const RATE_SET_ARGS = {
  key: AFFILIATE_SETTING_KEYS.defaultRevshareRate,
  value: '0.25',
  type: 'number' as const,
  updatedBy: 'admin-1',
}

let listRaw: ReturnType<typeof vi.fn>
let setValue: ReturnType<typeof vi.fn>
let service: AffiliateSettingsService

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: FIXED_NOW.getTime() })
  listRaw = vi.fn().mockResolvedValue([])
  setValue = vi.fn().mockResolvedValue(undefined)
  service = new AffiliateSettingsService({
    listRaw,
    set: setValue,
  } as unknown as AffiliateSettingsRepository)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('AffiliateSettingsService.get — дефолты и кэш', () => {
  it('пустая БД → дефолты, но ОТДЕЛЬНЫМ объектом', async () => {
    // Act
    const settings = await service.get()
    // Assert — мутация снимка не должна отравлять константу процесса
    expect(settings).toEqual(AFFILIATE_SETTINGS_DEFAULTS)
    expect(settings).not.toBe(AFFILIATE_SETTINGS_DEFAULTS)
    settings.cookieDays = 1
    service.invalidate()
    const reloaded: AffiliateSettings = await service.get()
    expect(reloaded.cookieDays).toBe(AFFILIATE_SETTINGS_DEFAULTS.cookieDays)
  })

  it('повторный read в пределах TTL не идёт в БД', async () => {
    // Arrange
    listRaw.mockResolvedValue([rawSetting(AFFILIATE_SETTING_KEYS.cookieDays, '45', 'number')])
    // Act
    const first = await service.get()
    const second = await service.get()
    // Assert — настройки читаются на каждом клике, поход в БД на каждый — долг
    expect(listRaw).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
    expect(first.cookieDays).toBe(45)
  })

  it('на границе TTL кэш перечитывается, на мс раньше — нет', async () => {
    // Arrange/Act — строго «больше половины TTL» ещё жив: сравнение в сервисе `<`
    await service.get()
    vi.advanceTimersByTime(AFFILIATE_SETTINGS_TTL_MS - 1)
    await service.get()
    expect(listRaw).toHaveBeenCalledTimes(1)
    // Act — ровно TTL: cacheExpiresAt догнал now, кэш считается протухшим
    vi.advanceTimersByTime(1)
    await service.get()
    // Assert
    expect(listRaw).toHaveBeenCalledTimes(2)
  })

  it('ставка из БД нормализуется до 4 знаков и остаётся строкой', async () => {
    // Arrange
    listRaw.mockResolvedValue([
      rawSetting(AFFILIATE_SETTING_KEYS.defaultRevshareRate, '0.25', 'number'),
    ])
    // Act
    const settings = await service.get()
    // Assert — деньги-чувствительный параметр не имеет права стать number
    expect(settings.defaultRevshareRate).toBe('0.2500')
    expect(typeof settings.defaultRevshareRate).toBe('string')
  })
})

describe('AffiliateSettingsService.set — валидация до записи', () => {
  it('недопустимое значение не доходит до репозитория', async () => {
    // Arrange — ставка вне диапазона [0, 1]
    const attempt = service.set({ ...RATE_SET_ARGS, value: '1.5' })
    // Act/Assert
    await expect(attempt).rejects.toBeInstanceOf(AffiliateSettingsInvalidError)
    expect(setValue).not.toHaveBeenCalled()
  })

  it('несовпадение type с ключом тоже отсекается до записи', async () => {
    // Arrange — boolean-ключ, записанный как number, парсер молча вернул бы дефолт
    const attempt = service.set({
      key: AFFILIATE_SETTING_KEYS.enabled,
      value: 'true',
      type: 'number',
      updatedBy: 'admin-1',
    })
    // Act/Assert
    await expect(attempt).rejects.toThrow(AffiliateSettingsInvalidError)
    expect(setValue).not.toHaveBeenCalled()
  })

  it('успешная запись инвалидирует кэш: следующий get читает новое значение', async () => {
    // Arrange — сначала кэш держит дефолтную ставку
    await service.get()
    expect(listRaw).toHaveBeenCalledTimes(1)
    // Act
    await service.set(RATE_SET_ARGS)
    // Assert
    expect(setValue).toHaveBeenCalledWith(RATE_SET_ARGS)
    await service.get()
    expect(listRaw).toHaveBeenCalledTimes(2)
  })

  it('отказ репозитория не инвалидирует кэш и не глотается', async () => {
    // Arrange
    await service.get()
    setValue.mockRejectedValueOnce(new Error('settings write conflict'))
    // Act/Assert
    await expect(service.set(RATE_SET_ARGS)).rejects.toThrow('settings write conflict')
    await service.get()
    expect(listRaw).toHaveBeenCalledTimes(1)
  })
})
