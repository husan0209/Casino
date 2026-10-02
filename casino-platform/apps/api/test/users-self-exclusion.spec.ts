/**
 * Юнит-тесты SelfExclusionUseCase (G21).
 *
 * Правила: период < 24ч сервером подтягивается до 24; 0 = перманент (100 лет);
 * отрицательный — ошибка. Исключение сразу отзывает сессии и уведомляет хук
 * ответственной игры (сбой хука не отменяет исключение). Снятие — только
 * после 72ч cooloff с момента установки (proxy: updatedAt).
 */
import {
  SelfExclusionActiveError,
  SelfExclusionCooloffError,
  SelfExclusionUseCase,
} from '../src/modules/users/application/use-cases/self-exclusion.use-case'
import { InvalidSelfExclusionPeriodError } from '../src/modules/users/domain/errors'
import type { ResponsibleGamingHook } from '../src/common/ports/responsible-gaming-hook'
import type {
  IUserSettingsRepository,
  UserExclusionSettings,
} from '../src/modules/users/domain/repositories/user-settings.repository'

function makeDeps(over: { settings?: UserExclusionSettings | null; hookError?: Error } = {}) {
  const upserted: Array<{ userId: string; until: Date }> = []
  const cleared: string[] = []
  const sessionsRevoked: string[] = []
  const hookCalls: string[] = []
  const settings: IUserSettingsRepository = {
    find: async () => over.settings ?? null,
    upsertExclusion: async (userId, until) => {
      upserted.push({ userId, until })
    },
    clearExclusion: async (userId) => {
      cleared.push(userId)
    },
    revokeActiveSessions: async (userId) => {
      sessionsRevoked.push(userId)
    },
  }
  const hook = {
    onSelfExclusion: async (userId: string) => {
      if (over.hookError) throw over.hookError
      hookCalls.push(userId)
    },
  } as unknown as ResponsibleGamingHook

  const uc = new SelfExclusionUseCase(settings, hook)
  return { uc, upserted, cleared, sessionsRevoked, hookCalls }
}

describe('SelfExclusionUseCase.exclude', () => {
  it('48ч: до исключения доезжает upsert, сессии отозваны, хук уведомлён', async () => {
    const d = makeDeps()
    const before = Date.now()
    const res = await d.uc.exclude('u-1', 48)

    expect(d.upserted).toHaveLength(1)
    const hours = (d.upserted[0]!.until.getTime() - before) / 3_600_000
    expect(hours).toBeGreaterThan(47.9)
    expect(hours).toBeLessThan(48.1)
    expect(d.sessionsRevoked).toEqual(['u-1'])
    expect(d.hookCalls).toEqual(['u-1'])
    expect(res.excludedUntil).toBe(d.upserted[0]!.until)
  })

  it('12ч → принудительно минимум 24ч (server-side clamp)', async () => {
    const d = makeDeps()
    const before = Date.now()
    await d.uc.exclude('u-1', 12)
    const hours = (d.upserted[0]!.until.getTime() - before) / 3_600_000
    expect(hours).toBeGreaterThan(23.9)
    expect(hours).toBeLessThan(24.1)
  })

  it('0 → перманент (~100 лет)', async () => {
    const d = makeDeps()
    const res = await d.uc.exclude('u-1', 0)
    const years = (res.excludedUntil!.getTime() - Date.now()) / (365 * 24 * 3_600_000)
    expect(years).toBeGreaterThan(99)
  })

  it('отрицательный период → InvalidSelfExclusionPeriodError, ничего не пишется', async () => {
    const d = makeDeps()
    await expect(d.uc.exclude('u-1', -5)).rejects.toThrow(InvalidSelfExclusionPeriodError)
    expect(d.upserted).toHaveLength(0)
    expect(d.sessionsRevoked).toHaveLength(0)
  })

  it('сбой хука ответственной игры не отменяет исключение (best-effort)', async () => {
    const d = makeDeps({ hookError: new Error('affiliate down') })
    const res = await d.uc.exclude('u-1', 48)
    expect(res.excludedUntil).toBe(d.upserted[0]!.until)
    expect(d.sessionsRevoked).toEqual(['u-1'])
  })
})

describe('SelfExclusionUseCase.lift', () => {
  it('исключения нет → ok:true, clearExclusion не вызывается', async () => {
    const d = makeDeps({ settings: null })
    await expect(d.uc.lift('u-1')).resolves.toEqual({ ok: true })
    expect(d.cleared).toHaveLength(0)
  })

  it('cooloff 72ч не истёк → SelfExclusionCooloffError, исключение не снимается', async () => {
    const d = makeDeps({
      settings: { selfExcludedUntil: new Date(Date.now() + 86_400_000), updatedAt: new Date(Date.now() - 3_600_000) },
    })
    await expect(d.uc.lift('u-1')).rejects.toThrow(SelfExclusionCooloffError)
    expect(d.cleared).toHaveLength(0)
  })

  it('cooloff истёк → исключение снято', async () => {
    const d = makeDeps({
      settings: { selfExcludedUntil: new Date(Date.now() - 86_400_000), updatedAt: new Date(Date.now() - 73 * 3_600_000) },
    })
    await expect(d.uc.lift('u-1')).resolves.toEqual({ ok: true })
    expect(d.cleared).toEqual(['u-1'])
  })
})

describe('SelfExclusionUseCase.assertNotExcluded', () => {
  it('настроек нет → пропускает', async () => {
    const d = makeDeps({ settings: null })
    await expect(d.uc.assertNotExcluded('u-1')).resolves.toBeUndefined()
  })

  it('исключение активно (в будущем) → SelfExclusionActiveError с датой', async () => {
    const until = new Date(Date.now() + 86_400_000)
    const d = makeDeps({ settings: { selfExcludedUntil: until, updatedAt: new Date() } })
    await expect(d.uc.assertNotExcluded('u-1')).rejects.toThrow(SelfExclusionActiveError)
    await expect(d.uc.assertNotExcluded('u-1')).rejects.toThrow('SELF_EXCLUDED_UNTIL')
  })

  it('исключение истекло → пропускает (срок сам снял запрет)', async () => {
    const d = makeDeps({
      settings: { selfExcludedUntil: new Date(Date.now() - 1000), updatedAt: new Date() },
    })
    await expect(d.uc.assertNotExcluded('u-1')).resolves.toBeUndefined()
  })
})
