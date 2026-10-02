/**
 * Юнит-тесты GetMeUseCase (G21).
 *
 * Прокси в профиль-репозиторий; отсутствие профиля → MeNotFoundError.
 */
import { GetMeUseCase } from '../src/modules/users/application/use-cases/get-me.use-case'
import { MeNotFoundError } from '../src/modules/users/domain/errors'
import type { IUserProfileRepository, UserProfileFull } from '../src/modules/users/domain/repositories/user-profile.repository'

function profile(): UserProfileFull {
  return {
    user: {
      id: 'u-1',
      email: 'user@test.dev',
      status: 'active',
      role: 'user',
      referralCode: 'REFCODE1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      hasPassword: true,
    },
    profile: {
      firstName: 'Иван',
      lastName: null,
      dateOfBirth: null,
      country: 'RU',
      city: null,
      avatarUrl: null,
      currencyPreference: 'RUB',
      lastPaymentMethod: 'card',
    },
    settings: {
      notificationsEmail: true,
      notificationsPush: false,
      language: 'ru',
      timezone: 'Europe/Moscow',
    },
    kycStatus: 'approved',
  }
}

describe('GetMeUseCase', () => {
  it('профиль возвращается как есть', async () => {
    const expected = profile()
    const repo = { getMe: async () => expected } as unknown as IUserProfileRepository
    const res = await new GetMeUseCase(repo).execute('u-1')
    expect(res).toBe(expected)
  })

  it('профиля нет → MeNotFoundError', async () => {
    const repo = { getMe: async () => null } as unknown as IUserProfileRepository
    await expect(new GetMeUseCase(repo).execute('u-404')).rejects.toThrow(MeNotFoundError)
  })

  it('отказ порта (getMe бросил) — ошибка пробрасывается', async () => {
    const repo = {
      getMe: async () => {
        throw new Error('db down')
      },
    } as unknown as IUserProfileRepository
    await expect(new GetMeUseCase(repo).execute('u-1')).rejects.toThrow('db down')
  })
})
