/**
 * Юнит-тесты UpdateProfileUseCase (G21).
 *
 * Контракт маппинга: snake_case контроллера → camelCase репозитория,
 * date_of_birth парсится в Date (или остаётся undefined).
 */
import { UpdateProfileUseCase } from '../src/modules/users/application/use-cases/update-profile.use-case'
import type { IUserProfileRepository } from '../src/modules/users/domain/repositories/user-profile.repository'

type UpdateArgs = {
  firstName?: string
  lastName?: string
  dateOfBirth?: Date | null
  country?: string
  city?: string
}

function makeDeps() {
  const got: Array<{ userId: string; data: UpdateArgs }> = []
  const repo = {
    updateProfile: async (userId: string, data: UpdateArgs) => {
      got.push({ userId, data })
    },
  } as unknown as IUserProfileRepository
  return { repo, got }
}

describe('UpdateProfileUseCase', () => {
  it('все поля: snake_case маппится в camelCase, дата парсится в Date', async () => {
    const { repo, got } = makeDeps()
    const res = await new UpdateProfileUseCase(repo).execute('u-1', {
      first_name: 'Иван',
      last_name: 'Петров',
      date_of_birth: '1990-05-15',
      country: 'RU',
      city: 'Москва',
    })

    expect(res).toEqual({ ok: true })
    expect(got).toEqual([
      {
        userId: 'u-1',
        data: {
          firstName: 'Иван',
          lastName: 'Петров',
          dateOfBirth: new Date('1990-05-15'),
          country: 'RU',
          city: 'Москва',
        },
      },
    ])
  })

  it('частичное обновление: непереданные поля остаются undefined (не затираются)', async () => {
    const { repo, got } = makeDeps()
    await new UpdateProfileUseCase(repo).execute('u-1', { city: 'Казань' })

    const data = got[0]!.data
    expect(data.city).toBe('Казань')
    expect(data.firstName).toBeUndefined()
    expect(data.lastName).toBeUndefined()
    expect(data.dateOfBirth).toBeUndefined()
    expect(data.country).toBeUndefined()
  })

  it('отказ порта (updateProfile бросил) — ошибка пробрасывается', async () => {
    const repo = {
      updateProfile: async () => {
        throw new Error('db down')
      },
    } as unknown as IUserProfileRepository
    await expect(new UpdateProfileUseCase(repo).execute('u-1', { city: 'Казань' })).rejects.toThrow(
      'db down',
    )
  })
})
