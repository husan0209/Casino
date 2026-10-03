/**
 * Юнит-тесты AffiliateClicksCleanupService — удаления кликов (слепая зона G21).
 *
 * Единственный риск этого job'а — не «неудалил», а «удалил лишнее»: delete по
 * неверному cutoff необратим. Отсюда два инварианта, которые тут проверяются:
 *  - срок хранения берётся ИЗ НАСТРОЕК программы, а не захардкожен, и cutoff
 *    считается ровно как `now − retentionDays·сутки` (проверяется абсолютной
 *    датой, чтобы поймать съезд на час из-за перехода на летнее время);
 *  - если настройки не прочитаны, удаление НЕ начинается. Job, который при
 *    недоступных настройках удалит всё «по дефолту», — это потеря атрибуции.
 * In-memory, без БД: `maintenance-jobs.spec.ts` проверяет регистрацию job'а в
 * расписании, а не арифметику cutoff — это разные проверки.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AffiliateClicksCleanupService } from '../src/modules/affiliate/application/affiliate-clicks-cleanup.service'
import { type AffiliateSettingsService } from '../src/modules/affiliate/application/affiliate-settings.service'
import { AFFILIATE_SETTINGS_DEFAULTS } from '../src/modules/affiliate/domain/affiliate-settings'
import { type AffiliateClickRepository } from '../src/modules/affiliate/domain/repositories/affiliate.repository'

const FIXED_NOW = new Date('2026-06-01T12:00:00.000Z')
const DAY_MS = 86_400_000

let cleanupOlderThan: ReturnType<typeof vi.fn>
let getSettings: ReturnType<typeof vi.fn>
let service: AffiliateClicksCleanupService

function makeService(retentionDays: number) {
  getSettings = vi.fn().mockResolvedValue({
    ...AFFILIATE_SETTINGS_DEFAULTS,
    clickRetentionDays: retentionDays,
  })
  cleanupOlderThan = vi.fn().mockResolvedValue(0)
  service = new AffiliateClicksCleanupService(
    { cleanupOlderThan } as unknown as AffiliateClickRepository,
    { get: getSettings } as unknown as AffiliateSettingsService,
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: FIXED_NOW.getTime() })
  makeService(AFFILIATE_SETTINGS_DEFAULTS.clickRetentionDays)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('AffiliateClicksCleanupService.execute — cutoff', () => {
  it('retention 180 дней → cutoff ровно на 180 суток назад', async () => {
    // Arrange
    cleanupOlderThan.mockResolvedValue(12)
    // Act
    const result = await service.execute()
    // Assert — абсолютная дата: сдвиг на час из-за DST поймается здесь
    expect(cleanupOlderThan).toHaveBeenCalledTimes(1)
    const cutoff = cleanupOlderThan.mock.calls[0]?.[0] as Date
    expect(cutoff.toISOString()).toBe('2025-12-03T12:00:00.000Z')
    expect(result).toEqual({ deleted: 12, retentionDays: 180 })
  })

  it('cutoff следует за настройкой, а не за константой в коде', async () => {
    // Arrange — минимально допустимый retention
    makeService(7)
    cleanupOlderThan.mockResolvedValue(1)
    // Act
    const result = await service.execute()
    // Assert
    const cutoff = cleanupOlderThan.mock.calls[0]?.[0] as Date
    expect(cutoff.getTime()).toBe(FIXED_NOW.getTime() - 7 * DAY_MS)
    expect(result).toEqual({ deleted: 1, retentionDays: 7 })
  })

  it('нет удалённых кликов → ноль в отчёте, без исключения', async () => {
    // Arrange
    cleanupOlderThan.mockResolvedValue(0)
    // Act
    const result = await service.execute()
    // Assert
    expect(result).toEqual({ deleted: 0, retentionDays: 180 })
  })
})

describe('AffiliateClicksCleanupService.execute — отказы зависимостей', () => {
  it('настройки непрочитаны → удаление не начинается', async () => {
    // Arrange — без срока хранения job обязан встать, а не удалять «по дефолту»
    getSettings.mockRejectedValue(new Error('settings unavailable'))
    // Act/Assert
    await expect(service.execute()).rejects.toThrow('settings unavailable')
    expect(cleanupOlderThan).not.toHaveBeenCalled()
  })

  it('отказ репозитория кликов не превращается в «успех с нулём»', async () => {
    // Arrange — иначе мониторинг увидит зелёный прогон при мёртвом БД-контуре
    cleanupOlderThan.mockRejectedValue(new Error('clicks table locked'))
    // Act/Assert
    await expect(service.execute()).rejects.toThrow('clicks table locked')
  })
})
