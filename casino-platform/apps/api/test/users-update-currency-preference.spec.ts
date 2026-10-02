/**
 * Юнит-тесты UpdateCurrencyPreferenceUseCase (G21).
 *
 * Прокси: репозиторий получает валюту как есть, наружу отдаётся эхо.
 */
import { UpdateCurrencyPreferenceUseCase } from '../src/modules/users/application/use-cases/update-currency-preference.use-case'

import type { IUserProfileRepository } from '../src/modules/users/domain/repositories/user-profile.repository'

describe('UpdateCurrencyPreferenceUseCase', () => {
  it('валюта проксируется в репозиторий, наружу возвращается эхо', async () => {
    const got: Array<{ userId: string; currency: string }> = []
    const repo = {
      updateCurrencyPreference: async (userId: string, currency: string) => {
        got.push({ userId, currency })
      },
    } as unknown as IUserProfileRepository

    const res = await new UpdateCurrencyPreferenceUseCase(repo).execute('u-1', 'USDT_TRC20')

    expect(got).toEqual([{ userId: 'u-1', currency: 'USDT_TRC20' }])
    expect(res).toEqual({ currency_preference: 'USDT_TRC20' })
  })

  it('отказ порта (updateCurrencyPreference бросил) — ошибка пробрасывается', async () => {
    const repo = {
      updateCurrencyPreference: async () => {
        throw new Error('db down')
      },
    } as unknown as IUserProfileRepository
    await expect(
      new UpdateCurrencyPreferenceUseCase(repo).execute('u-1', 'RUB'),
    ).rejects.toThrow('db down')
  })
})
