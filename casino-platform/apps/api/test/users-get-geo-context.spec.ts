/**
 * Юнит-тесты GetGeoContextUseCase (G21).
 *
 * Прокси в профиль-репозиторий: null (нет настроек) и заполненный контекст
 * возвращаются как есть — решение о валюте принимает geo-слой.
 */
import { GetGeoContextUseCase } from '../src/modules/users/application/use-cases/get-geo-context.use-case'

import type {
  IUserProfileRepository,
  UserGeoContext,
} from '../src/modules/users/domain/repositories/user-profile.repository'

describe('GetGeoContextUseCase', () => {
  it('контекст возвращается как есть', async () => {
    const expected: UserGeoContext = {
      currencyPreference: 'USDT_TRC20',
      lastPaymentMethod: 'usdt_trc20',
      country: 'RU',
    }
    const repo = { getGeoContext: async () => expected } as unknown as IUserProfileRepository
    const res = await new GetGeoContextUseCase(repo).execute('u-1')
    expect(res).toBe(expected)
  })

  it('настроек нет → null без ошибки (гость/чистый аккаунт)', async () => {
    const repo = { getGeoContext: async () => null } as unknown as IUserProfileRepository
    await expect(new GetGeoContextUseCase(repo).execute('u-1')).resolves.toBeNull()
  })

  it('отказ порта (getGeoContext бросил) — ошибка пробрасывается', async () => {
    const repo = {
      getGeoContext: async () => {
        throw new Error('db down')
      },
    } as unknown as IUserProfileRepository
    await expect(new GetGeoContextUseCase(repo).execute('u-1')).rejects.toThrow('db down')
  })
})
