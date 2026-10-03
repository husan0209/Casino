/**
 * Юнит-тесты UpdateSettingsUseCase (G21).
 *
 * Контракт: в репозиторий уходят только переданные ключи (частичный upsert),
 * snake_case → camelCase.
 */
import { UpdateSettingsUseCase } from '../src/modules/users/application/use-cases/update-settings.use-case'

import type { IUserProfileRepository } from '../src/modules/users/domain/repositories/user-profile.repository'

type UpdateArgs = {
  notificationsEmail?: boolean
  notificationsPush?: boolean
  language?: string
  timezone?: string
}

function makeDeps() {
  const got: Array<{ userId: string; data: UpdateArgs }> = []
  const repo = {
    updateSettings: async (userId: string, data: UpdateArgs) => {
      got.push({ userId, data })
    },
  } as unknown as IUserProfileRepository
  return { repo, got }
}

describe('UpdateSettingsUseCase', () => {
  it('все поля маппятся snake_case → camelCase', async () => {
    const { repo, got } = makeDeps()
    const res = await new UpdateSettingsUseCase(repo).execute('u-1', {
      notifications_email: false,
      notifications_push: true,
      language: 'en',
      timezone: 'UTC',
    })

    expect(res).toEqual({ ok: true })
    expect(got).toEqual([
      {
        userId: 'u-1',
        data: {
          notificationsEmail: false,
          notificationsPush: true,
          language: 'en',
          timezone: 'UTC',
        },
      },
    ])
  })

  it('частичное обновление: непереданные ключи в репозиторий не попадают вовсе', async () => {
    const { repo, got } = makeDeps()
    await new UpdateSettingsUseCase(repo).execute('u-1', { language: 'ru' })

    const data = got[0]!.data as Record<string, unknown>
    expect(data.language).toBe('ru')
    expect(Object.hasOwn(data, 'notificationsEmail')).toBe(false)
    expect(Object.hasOwn(data, 'notificationsPush')).toBe(false)
    expect(Object.hasOwn(data, 'timezone')).toBe(false)
  })

  it('отказ порта (updateSettings бросил) — ошибка пробрасывается', async () => {
    const repo = {
      updateSettings: async () => {
        throw new Error('db down')
      },
    } as unknown as IUserProfileRepository
    await expect(
      new UpdateSettingsUseCase(repo).execute('u-1', { language: 'ru' }),
    ).rejects.toThrow('db down')
  })
})
